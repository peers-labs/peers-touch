package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestFollowUpSuggestionsRejectMalformedOrUnboundedProviderOutput(t *testing.T) {
	for _, content := range []string{
		`["one","two"]`, `["one","one","three"]`, `["one"," ","three"]`,
		"not JSON", `{"suggestions":["one","two","three"]}`,
		`["one","two","` + strings.Repeat("界", 241) + `"]`,
	} {
		if result := parseFollowUpSuggestions(content); result != nil {
			t.Fatalf("accepted malformed suggestions: %q", content)
		}
	}
	result := parseFollowUpSuggestions(`[" one ","第二个问题","third"]`)
	if len(result) != 3 || result[0] != "one" {
		t.Fatalf("valid suggestions lost: %v", result)
	}
}

func TestFollowUpSuggestionsSurviveTerminalEventSerialization(t *testing.T) {
	want := []string{"one", "two", "three"}
	payload, err := json.Marshal(TurnEvent{Type: "done", Suggestions: want})
	if err != nil {
		t.Fatal(err)
	}
	var restored TurnEvent
	if err := json.Unmarshal(payload, &restored); err != nil {
		t.Fatal(err)
	}
	if strings.Join(restored.Suggestions, "|") != strings.Join(want, "|") {
		t.Fatalf("replay lost suggestions: %s", payload)
	}
}

func TestFollowUpSuggestionsCommitWithTerminalEvent(t *testing.T) {
	db := openConversationAuthorityDB(t, "follow_up_terminal")
	now := time.Now()
	for _, record := range []any{
		&persistence.Conversation{ID: "follow-up-conv", AgentID: "agent", ActorPTID: "actor",
			Title: "Follow-up", Status: "active", CreatedAt: now, UpdatedAt: now},
		&persistence.AgentTurn{ID: "follow-up-turn", ConversationID: "follow-up-conv",
			AgentID: "agent", Status: string(domain.TurnStatusRunning), StartedAt: now},
		&persistence.TurnAttempt{ID: "follow-up-attempt", TurnID: "follow-up-turn",
			AttemptIndex: 1, Status: string(domain.TurnStatusRunning), StartedAt: now},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	var delivered TurnEvent
	config := &TurnConfig{
		ConversationID: "follow-up-conv", AgentID: "agent", AttemptID: "follow-up-attempt",
		followUpSuggestions: []string{"one", "two", "three"},
		EventSink:           func(_ context.Context, event TurnEvent) { delivered = event },
	}
	service := TurnService{convService: NewConversationService()}
	if err := service.completeTurn(context.Background(), config, "follow-up-turn", "answer", 0); err != nil {
		t.Fatal(err)
	}
	var stored persistence.TurnEvent
	if err := db.Where("turn_id = ? AND event_type = ?", "follow-up-turn", "done").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	var assistant persistence.AgentMessage
	if err := db.Where(
		"turn_id = ? AND role = ?",
		"follow-up-turn",
		string(domain.MessageRoleAssistant),
	).First(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(delivered)
	if !strings.Contains(string(encoded), `"suggestions":["one","two","three"]`) ||
		!strings.Contains(string(stored.Payload), `"suggestions":["one","two","three"]`) ||
		!strings.Contains(string(assistant.MetadataJSON), `"follow_up_suggestions":["one","two","three"]`) {
		t.Fatalf(
			"terminal suggestions not committed to event and message or delivered: %s %+v %s",
			encoded,
			stored,
			assistant.MetadataJSON,
		)
	}
}

func TestFollowUpSuggestionsPreservePendingAssistantMetadata(t *testing.T) {
	db := openConversationAuthorityDB(t, "follow_up_pending_metadata")
	now := time.Now()
	turnID := "follow-up-pending-turn"
	messageID := "follow-up-pending-message"
	for _, record := range []any{
		&persistence.Conversation{
			ID: "follow-up-pending-conv", AgentID: "agent", ActorPTID: "actor",
			Title: "Follow-up", Status: "active", CreatedAt: now, UpdatedAt: now,
		},
		&persistence.AgentTurn{
			ID: turnID, ConversationID: "follow-up-pending-conv",
			AgentID: "agent", Status: string(domain.TurnStatusRunning), StartedAt: now,
		},
		&persistence.TurnAttempt{
			ID: "follow-up-pending-attempt", TurnID: turnID,
			AttemptIndex: 1, Status: string(domain.TurnStatusRunning), StartedAt: now,
		},
		&persistence.AgentMessage{
			ID: messageID, ConversationID: "follow-up-pending-conv", TurnID: &turnID,
			Role: string(domain.MessageRoleAssistant), Status: "pending", Seq: 1,
			MetadataJSON: json.RawMessage(`{"translation":"preserved"}`),
			CreatedAt:    now, UpdatedAt: now,
		},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := TurnService{convService: NewConversationService()}
	config := &TurnConfig{
		ConversationID: "follow-up-pending-conv",
		AgentID:        "agent", AttemptID: "follow-up-pending-attempt",
		AssistantMessageID:  messageID,
		followUpSuggestions: []string{"one", "two", "three"},
	}
	if err := service.completeTurn(context.Background(), config, turnID, "answer", 0); err != nil {
		t.Fatal(err)
	}
	var assistant persistence.AgentMessage
	if err := db.First(&assistant, "id = ?", messageID).Error; err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Translation         string   `json:"translation"`
		FollowUpSuggestions []string `json:"follow_up_suggestions"`
	}
	if err := json.Unmarshal(assistant.MetadataJSON, &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.Translation != "preserved" ||
		strings.Join(metadata.FollowUpSuggestions, "|") != "one|two|three" {
		t.Fatalf("assistant metadata = %+v", metadata)
	}
}
