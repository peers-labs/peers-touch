package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestPromptAssemblyCanonicalTurnSegments(t *testing.T) {
	service := NewPromptAssemblyService(nil, nil)
	currentInput := "Implement the typed ContextLedger."
	result, err := service.AssembleTurnContext(
		context.Background(),
		"agent-1",
		"Backend architect",
		"Follow the accepted architecture.",
		nil,
		currentInput,
		nil,
		&AuthorizedCapabilitySet{},
		true,
		PromptAssemblyContext{
			TurnID:         "turn-2",
			ConversationID: "conversation-1",
			Messages: []domain.Message{
				{
					MessageID: "summary-1",
					Role:      domain.MessageRoleSystem,
					Content:   "Earlier turns established the proto contract.",
				},
				{
					MessageID: "message-1",
					TurnID:    "turn-1",
					Role:      domain.MessageRoleUser,
					Content:   "Keep Station as the authority.",
				},
				{
					MessageID: "message-2",
					TurnID:    "turn-1",
					Role:      domain.MessageRoleAssistant,
					Content:   "Acknowledged.",
				},
				{
					MessageID: "message-3",
					TurnID:    "turn-2",
					Role:      domain.MessageRoleUser,
					Content:   currentInput,
				},
			},
			SkillBodies: []SkillBodyContext{{
				SkillID: "skill-1",
				Name:    "station-context",
				Version: 3,
				Content: "Use Station-owned typed context.",
			}},
			WorkspaceReference: "workspace-1",
		},
	)
	if err != nil {
		t.Fatalf("assemble canonical turn context: %v", err)
	}

	expectedTypes := []model.ContextSegmentType{
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_IDENTITY,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MODEL_FACTS,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_HISTORY,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SUMMARY,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_WORKSPACE_REFERENCE,
		model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_CURRENT_INPUT,
	}
	if len(result.Segments) != len(expectedTypes) {
		t.Fatalf("segment count = %d, want %d: %+v", len(result.Segments), len(expectedTypes), result.Segments)
	}
	for index, expectedType := range expectedTypes {
		if result.Segments[index].Type != expectedType {
			t.Fatalf("segment %d type = %s, want %s", index, result.Segments[index].Type, expectedType)
		}
	}

	current := result.Segments[len(result.Segments)-1]
	if current.Content != currentInput ||
		current.ContentHash != sha256Hex(currentInput) ||
		len(current.SourceRefs) != 1 ||
		current.SourceRefs[0] != "turn:turn-2:input" {
		t.Fatalf("current input segment does not describe the user input: %+v", current)
	}
	history := result.Segments[4]
	if strings.Contains(history.Content, currentInput) ||
		!strings.Contains(history.Content, "Keep Station as the authority.") {
		t.Fatalf("history segment has incorrect turn boundaries: %+v", history)
	}
	if strings.Contains(result.SystemPrompt, currentInput) ||
		strings.Contains(result.SystemPrompt, history.Content) {
		t.Fatalf("message inputs were duplicated into the system prompt: %q", result.SystemPrompt)
	}
}

func TestPromptAssemblyRejectsLocalWorkspacePath(t *testing.T) {
	segments, err := (workspaceReferenceProcessor{}).process(&promptBuildInput{
		turnContext: PromptAssemblyContext{
			WorkspaceReference: "/Users/example/project",
		},
	})
	if err != nil {
		t.Fatalf("process local workspace path: %v", err)
	}
	if len(segments) != 1 ||
		segments[0].Decision != model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED ||
		segments[0].DecisionReason != "local_path_not_authorized" ||
		segments[0].Content != "" ||
		len(segments[0].SourceRefs) != 0 {
		t.Fatalf("local workspace path leaked into context: %+v", segments)
	}
}

func TestContextLedgerPersistenceRedactsBodiesAndKeepsCanonicalOrder(t *testing.T) {
	segments := []ContextSegment{
		{
			Type:        model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_CURRENT_INPUT,
			Content:     "private user input",
			ContentHash: sha256Hex("private user input"),
		},
		contextSegmentForSkillBody(&domain.SkillManifest{
			SkillID: "skill-1",
			Version: 2,
			Content: "private skill body",
		}),
	}
	sortContextSegments(segments)
	redacted := redactedContextSegments(segments)

	if redacted[0].Type != model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY ||
		redacted[1].Type != model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_CURRENT_INPUT {
		t.Fatalf("segments are not in canonical order: %+v", redacted)
	}
	for _, segment := range redacted {
		if segment.Content != "" || segment.ContentHash == "" {
			t.Fatalf("persisted segment must retain attribution without content: %+v", segment)
		}
	}
}

func TestActivatedSkillBodyRecomputesPersistedContextLedgerInputTokens(t *testing.T) {
	db := openConversationAuthorityDB(t, "context_ledger_activated_skill")
	now := time.Now().UTC()
	if err := db.Create(&persistence.TurnAttempt{
		ID:           "attempt-skill-ledger",
		TurnID:       "turn-skill-ledger",
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusRunning),
		StartedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed turn attempt: %v", err)
	}
	service := &TurnService{}
	initial := &model.ContextLedger{
		ContextLedgerId:      "context:attempt-skill-ledger",
		TurnId:               "turn-skill-ledger",
		AttemptId:            "attempt-skill-ledger",
		EstimatedInputTokens: 11,
		Segments: []*model.ContextSegment{{
			SegmentId:       "context:attempt-skill-ledger:1",
			Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_CURRENT_INPUT,
			SourceRefs:      []string{"turn:turn-skill-ledger:input"},
			ContentHash:     sha256Hex("current input"),
			EstimatedTokens: 11,
			Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
		}},
	}
	initialHash, err := contextLedgerHash(initial)
	if err != nil {
		t.Fatalf("hash initial ContextLedger: %v", err)
	}
	initial.PromptHash = initialHash
	if err := service.persistContextLedger(context.Background(), initial); err != nil {
		t.Fatalf("persist initial ContextLedger: %v", err)
	}

	skillSegment := contextSegmentForSkillBody(&domain.SkillManifest{
		SkillID: "skill-activated",
		Version: 3,
		Content: "Apply the governed workflow.",
	})
	if err := service.upsertContextLedgerSegment(
		context.Background(),
		initial.GetAttemptId(),
		skillSegment,
	); err != nil {
		t.Fatalf("insert activated Skill body: %v", err)
	}

	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", initial.GetAttemptId()).Error; err != nil {
		t.Fatalf("load updated ContextLedger: %v", err)
	}
	var updated model.ContextLedger
	if err := protojson.Unmarshal([]byte(attempt.ContextLedger), &updated); err != nil {
		t.Fatalf("decode updated ContextLedger: %v", err)
	}
	wantTokens := uint64(11 + skillSegment.EstimatedTokens)
	if updated.GetEstimatedInputTokens() != wantTokens {
		t.Fatalf(
			"estimated_input_tokens = %d, want %d",
			updated.GetEstimatedInputTokens(),
			wantTokens,
		)
	}
	if len(updated.GetSegments()) != 2 ||
		updated.GetSegments()[0].GetType() != model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY ||
		updated.GetPromptHash() == initialHash {
		t.Fatalf("activated Skill ledger was not rebuilt exactly: %+v", &updated)
	}
}
