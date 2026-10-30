package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

func seedTerminalSettlementConversation(t *testing.T, db *gorm.DB, now time.Time) {
	t.Helper()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_terminal",
		AgentID:   "agent_1",
		ActorPTID: "actor_1",
		Title:     "Terminal settlement",
		Status:    "active",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
}

func terminalOutcomeJSON(t *testing.T) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"error_type": "LIFECYCLE_CANCELLED"})
	if err != nil {
		t.Fatalf("marshal outcome: %v", err)
	}
	return raw
}

// Cancellation (or failure) before the first assistant text projection must
// still leave a terminal assistant message row, otherwise history hydration
// drops the assistant side of the turn after reload.
func TestSettleTerminalAssistantMessageCreatesRowForAdmittedTurn(t *testing.T) {
	db := openConversationAuthorityDB(t, "terminal_message_create")
	now := time.Now()
	seedTerminalSettlementConversation(t, db, now)
	if err := db.Create(&persistence.AgentMessage{
		ID:             "msg_user_1",
		ConversationID: "conv_terminal",
		TurnID:         optionalString("turn_terminal"),
		Role:           string(domain.MessageRoleUser),
		Status:         "completed",
		Content:        optionalString("hello"),
		ModelName:      optionalString("ep-model-1"),
		Seq:            1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed user message: %v", err)
	}
	outcome := terminalOutcomeJSON(t)

	err := db.Transaction(func(tx *gorm.DB) error {
		return settleTerminalAssistantMessageTx(
			context.Background(), tx, "turn_terminal", "conv_terminal",
			string(domain.TurnStatusCancelled), []string{"pending"}, outcome, now,
		)
	})
	if err != nil {
		t.Fatalf("settle terminal message: %v", err)
	}

	var rows []persistence.AgentMessage
	if err := db.Where("turn_id = ? AND role = ?", "turn_terminal", string(domain.MessageRoleAssistant)).
		Find(&rows).Error; err != nil {
		t.Fatalf("load assistant rows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("assistant rows = %d, want exactly 1", len(rows))
	}
	row := rows[0]
	if row.Status != string(domain.TurnStatusCancelled) {
		t.Fatalf("status = %q, want cancelled", row.Status)
	}
	if row.ModelName == nil || *row.ModelName != "ep-model-1" {
		t.Fatalf("model_name = %v, want admission model ep-model-1", row.ModelName)
	}
	if row.Seq != 2 {
		t.Fatalf("seq = %d, want 2", row.Seq)
	}
	if len(row.ErrorJSON) == 0 {
		t.Fatal("error_json empty, want terminal outcome payload")
	}
}

// An existing pending assistant message is updated in place; the settlement
// never appends a duplicate placeholder.
func TestSettleTerminalAssistantMessageUpdatesPendingWithoutDuplicate(t *testing.T) {
	db := openConversationAuthorityDB(t, "terminal_message_update")
	now := time.Now()
	seedTerminalSettlementConversation(t, db, now)
	messages := []persistence.AgentMessage{
		{
			ID: "msg_user_1", ConversationID: "conv_terminal", TurnID: optionalString("turn_terminal"),
			Role: "user", Status: "completed", Content: optionalString("hello"),
			ModelName: optionalString("ep-model-1"), Seq: 1, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "msg_assistant_1", ConversationID: "conv_terminal", TurnID: optionalString("turn_terminal"),
			Role: string(domain.MessageRoleAssistant), Status: "pending", Content: optionalString("partial"),
			Seq: 2, CreatedAt: now, UpdatedAt: now,
		},
	}
	for i := range messages {
		if err := db.Create(&messages[i]).Error; err != nil {
			t.Fatalf("seed message %d: %v", i, err)
		}
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		return settleTerminalAssistantMessageTx(
			context.Background(), tx, "turn_terminal", "conv_terminal",
			string(domain.TurnStatusCancelled), []string{"pending"},
			terminalOutcomeJSON(t), now,
		)
	})
	if err != nil {
		t.Fatalf("settle terminal message: %v", err)
	}

	var rows []persistence.AgentMessage
	if err := db.Where("turn_id = ? AND role = ?", "turn_terminal", string(domain.MessageRoleAssistant)).
		Find(&rows).Error; err != nil {
		t.Fatalf("load assistant rows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("assistant rows = %d, want 1 (no duplicate)", len(rows))
	}
	if rows[0].ID != "msg_assistant_1" || rows[0].Status != string(domain.TurnStatusCancelled) {
		t.Fatalf("unexpected terminal row: id=%s status=%s", rows[0].ID, rows[0].Status)
	}
}

// Pre-admission termination (no admitted user message) must not orphan an
// assistant message row.
func TestSettleTerminalAssistantMessageSkipsPreAdmissionTurn(t *testing.T) {
	db := openConversationAuthorityDB(t, "terminal_message_preadmission")
	now := time.Now()
	seedTerminalSettlementConversation(t, db, now)

	err := db.Transaction(func(tx *gorm.DB) error {
		return settleTerminalAssistantMessageTx(
			context.Background(), tx, "turn_preadmit", "conv_terminal",
			string(domain.TurnStatusFailed), []string{"pending"},
			terminalOutcomeJSON(t), now,
		)
	})
	if err != nil {
		t.Fatalf("settle terminal message: %v", err)
	}

	var count int64
	if err := db.Model(&persistence.AgentMessage{}).
		Where("turn_id = ?", "turn_preadmit").Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 0 {
		t.Fatalf("projected messages = %d, want 0 for pre-admission turn", count)
	}
}

func TestTerminalMessagePreservesAdmittedLineageAndSelectedSibling(t *testing.T) {
	for _, selected := range []string{"msg_user_2", "msg_sibling"} {
		t.Run(selected, func(t *testing.T) {
			db := openConversationAuthorityDB(t, "terminal_lineage_"+selected)
			now := time.Now()
			seedTerminalSettlementConversation(t, db, now)
			rows := []persistence.AgentMessage{
				{ID: "msg_root", ConversationID: "conv_terminal", Role: "user", Seq: 1},
				{ID: "msg_sibling", ConversationID: "conv_terminal", Role: "assistant", Seq: 2, ParentMessageID: optionalString("msg_root")},
				{ID: "msg_prior", ConversationID: "conv_terminal", Role: "assistant", Seq: 3, ParentMessageID: optionalString("msg_root")},
				{ID: "msg_user_2", ConversationID: "conv_terminal", Role: "user", Seq: 4,
					TurnID: optionalString("turn_terminal"), ParentMessageID: optionalString("msg_prior"),
					BranchID: optionalString("branch_2"), ModelName: optionalString("ep-model-1")},
			}
			for i := range rows {
				rows[i].Status = "completed"
				if err := db.Create(&rows[i]).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Model(&persistence.Conversation{}).Where("id = ?", "conv_terminal").
				Update("active_branch_message_id", selected).Error; err != nil {
				t.Fatal(err)
			}
			settle := func() error {
				return db.Transaction(func(tx *gorm.DB) error {
					return settleTerminalAssistantMessageTx(context.Background(), tx,
						"turn_terminal", "conv_terminal", "cancelled", []string{"pending"}, nil, now)
				})
			}
			if err := settle(); err != nil {
				t.Fatal(err)
			}
			if err := settle(); err != nil {
				t.Fatal(err)
			}
			var assistants []persistence.AgentMessage
			if err := db.Where("turn_id = ? AND role = ?", "turn_terminal", "assistant").Find(&assistants).Error; err != nil {
				t.Fatal(err)
			}
			if len(assistants) != 1 || revisionStringValue(assistants[0].ParentMessageID) != "msg_user_2" ||
				revisionStringValue(assistants[0].BranchID) != "branch_2" {
				t.Fatalf("terminal projection lost admitted lineage: %+v", assistants)
			}
			var conversation persistence.Conversation
			if err := db.First(&conversation, "id = ?", "conv_terminal").Error; err != nil {
				t.Fatal(err)
			}
			expected := selected
			if selected == "msg_user_2" {
				expected = assistants[0].ID
			}
			if conversation.ActiveBranchMessageID != expected {
				t.Fatalf("selected head = %s, want %s", conversation.ActiveBranchMessageID, expected)
			}
		})
	}
}
