package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// TestEnsureChatTaskStoresGoalAndCanonicalIdentity pins the D1 canonical
// contract: first send creates exactly one Chat task per conversation, the
// accepted goal text is stored (distinct from the display title), later Turns
// never overwrite it, and the read resolver projects the same identity in
// batch.
func TestEnsureChatTaskStoresGoalAndCanonicalIdentity(t *testing.T) {
	db := openConversationAuthorityDB(t, "chat_task_identity")
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatalf("migrate Agent models: %v", err)
	}

	svc := NewChatTaskService(nil)
	ctx := context.Background()
	const actorPTID = "ptid:person:owner"
	const conversationID = "conversation-identity"
	const goal = "Write the full acceptance report, not a title"

	firstTaskID, err := svc.EnsureChatTask(ctx, actorPTID, "agent-1", conversationID, "Write the full", goal)
	if err != nil {
		t.Fatalf("first EnsureChatTask: %v", err)
	}

	// Repeated admission (same conversation, later Turn with different input)
	// returns the same task and must not overwrite the stored goal.
	secondTaskID, err := svc.EnsureChatTask(ctx, actorPTID, "agent-1", conversationID, "Unrelated later input", "later turn input")
	if err != nil {
		t.Fatalf("second EnsureChatTask: %v", err)
	}
	if firstTaskID != secondTaskID {
		t.Fatalf("canonical task changed across turns: first=%s second=%s", firstTaskID, secondTaskID)
	}

	var row persistence.TaskRun
	if err := db.Where("task_id = ?", firstTaskID).First(&row).Error; err != nil {
		t.Fatalf("reload chat task: %v", err)
	}
	if row.ConversationID != conversationID {
		t.Fatalf("canonical conversation link missing: %q", row.ConversationID)
	}
	if row.Surface != int32(model.TaskSurface_TASK_SURFACE_CHAT) {
		t.Fatalf("unexpected task surface: %d", row.Surface)
	}
	if row.Description != goal {
		t.Fatalf("goal overwritten or not stored: got %q want %q", row.Description, goal)
	}
	if row.Title != "Write the full" {
		t.Fatalf("display title mismatch: %q", row.Title)
	}

	// Batch identity resolver: owned conversation maps, foreign owner does not.
	otherTaskID, err := svc.EnsureChatTask(ctx, "ptid:person:other", "agent-1", "conversation-other", "Other goal", "Other goal")
	if err != nil {
		t.Fatalf("create other-actor task: %v", err)
	}
	if otherTaskID == firstTaskID {
		t.Fatalf("task id collision across conversations")
	}

	identity, err := svc.TaskIDsForConversations(ctx, actorPTID, []string{
		conversationID,
		"conversation-other",
		"conversation-missing",
		"",
	})
	if err != nil {
		t.Fatalf("resolve task identities: %v", err)
	}
	if identity[conversationID] != firstTaskID {
		t.Fatalf("owned conversation identity missing: %v", identity)
	}
	if _, exposed := identity["conversation-other"]; exposed {
		t.Fatalf("foreign-actor task must not resolve for this actor")
	}
	if _, exposed := identity["conversation-missing"]; exposed {
		t.Fatalf("unknown conversation must be absent, not zero-valued")
	}

	single, err := svc.TaskIDForConversation(ctx, actorPTID, conversationID)
	if err != nil {
		t.Fatalf("single identity lookup: %v", err)
	}
	if single != firstTaskID {
		t.Fatalf("single identity mismatch: %q", single)
	}
}
