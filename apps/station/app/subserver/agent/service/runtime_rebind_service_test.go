package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

const rebindTestActorPTID = "ptid:person:owner"

func seedRebindConversation(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
	binding *model.ConversationRuntimeBinding,
	version uint64,
) {
	t.Helper()
	now := time.Now().UTC()
	row := persistence.Conversation{
		ID:         conversationID,
		AgentID:    "agent-1",
		ActorPTID:  rebindTestActorPTID,
		Title:      "Runtime rebind",
		ProviderID: "provider-1",
		Status:     "active",
		Version:    version,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if binding != nil {
		encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
		if err != nil {
			t.Fatalf("marshal runtime binding: %v", err)
		}
		row.RuntimeBinding = encoded
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("seed rebind conversation: %v", err)
	}
}

func directModelRebindBinding() *model.ConversationRuntimeBinding {
	return &model.ConversationRuntimeBinding{
		RuntimeKind: model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:  "provider-1",
		ModelId:     "model-1",
	}
}

func assertBizErrorCode(t *testing.T, err error, want errcode.Code) {
	t.Helper()
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) {
		t.Fatalf("error type = %T, want *errcode.BizError", err)
	}
	if bizErr.Code != want {
		t.Fatalf("error code = %s, want %s (err=%v)", bizErr.Code, want, err)
	}
}

func TestRebindConversationRuntimeReleasesStaleDirectBinding(t *testing.T) {
	db := openConversationAuthorityDB(t, "runtime_rebind_release")
	seedRebindConversation(t, db, "conversation-rebind", directModelRebindBinding(), 1)

	result, err := NewConversationService().RebindConversationRuntime(
		context.Background(),
		rebindTestActorPTID,
		"conversation-rebind",
		1,
	)
	if err != nil {
		t.Fatalf("rebind runtime: %v", err)
	}
	if result == nil || result.Conversation == nil {
		t.Fatal("rebind result conversation is missing")
	}
	if result.Conversation.RuntimeBinding != nil {
		t.Fatalf("domain binding not released: %+v", result.Conversation.RuntimeBinding)
	}

	var reloaded persistence.Conversation
	if err := db.First(&reloaded, "id = ?", "conversation-rebind").Error; err != nil {
		t.Fatalf("reload conversation: %v", err)
	}
	if len(reloaded.RuntimeBinding) != 0 {
		t.Fatalf("persisted binding not cleared, %d bytes remain", len(reloaded.RuntimeBinding))
	}
	if reloaded.Version != 2 {
		t.Fatalf("conversation version = %d, want 2", reloaded.Version)
	}

	var event persistence.TurnEvent
	if err := db.
		Where("conversation_id = ? AND event_type = ?", "conversation-rebind", "runtime_rebind").
		First(&event).Error; err != nil {
		t.Fatalf("load runtime_rebind audit event: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		t.Fatalf("decode audit payload: %v", err)
	}
	if payload["event"] != "runtime_rebind" {
		t.Fatalf("audit payload event = %v, want runtime_rebind", payload["event"])
	}
	previous, ok := payload["previous"].(map[string]any)
	if !ok {
		t.Fatalf("audit payload missing previous tuple: %+v", payload)
	}
	if previous["provider_id"] != "provider-1" || previous["model_id"] != "model-1" {
		t.Fatalf("audit previous tuple = %+v", previous)
	}
}

func TestRebindConversationRuntimeRejectsVersionMismatch(t *testing.T) {
	db := openConversationAuthorityDB(t, "runtime_rebind_version")
	seedRebindConversation(t, db, "conversation-rebind", directModelRebindBinding(), 1)

	_, err := NewConversationService().RebindConversationRuntime(
		context.Background(),
		rebindTestActorPTID,
		"conversation-rebind",
		99,
	)
	assertBizErrorCode(t, err, errcode.AgentLifecycleStaleVersion)

	var reloaded persistence.Conversation
	if err := db.First(&reloaded, "id = ?", "conversation-rebind").Error; err != nil {
		t.Fatalf("reload conversation: %v", err)
	}
	if reloaded.Version != 1 || len(reloaded.RuntimeBinding) == 0 {
		t.Fatalf("conversation mutated after rejected rebind: version=%d bindingBytes=%d",
			reloaded.Version, len(reloaded.RuntimeBinding))
	}
}

func TestRebindConversationRuntimeRejectsExternalAgentBinding(t *testing.T) {
	db := openConversationAuthorityDB(t, "runtime_rebind_external")
	externalBinding := &model.ConversationRuntimeBinding{
		RuntimeKind: model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
		ProviderId:  "provider-1",
		ModelId:     "model-1",
	}
	seedRebindConversation(t, db, "conversation-rebind", externalBinding, 1)

	_, err := NewConversationService().RebindConversationRuntime(
		context.Background(),
		rebindTestActorPTID,
		"conversation-rebind",
		1,
	)
	assertBizErrorCode(t, err, errcode.AgentInvalidSourceState)
}

func TestRebindConversationRuntimeNoopWithoutBinding(t *testing.T) {
	db := openConversationAuthorityDB(t, "runtime_rebind_noop")
	seedRebindConversation(t, db, "conversation-rebind", nil, 1)

	result, err := NewConversationService().RebindConversationRuntime(
		context.Background(),
		rebindTestActorPTID,
		"conversation-rebind",
		1,
	)
	if err != nil {
		t.Fatalf("rebind no-op: %v", err)
	}
	if result == nil || result.Conversation == nil {
		t.Fatal("rebind result conversation is missing")
	}

	var eventCount int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("conversation_id = ? AND event_type = ?", "conversation-rebind", "runtime_rebind").
		Count(&eventCount).Error; err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("no-op rebind wrote %d audit events, want 0", eventCount)
	}

	var reloaded persistence.Conversation
	if err := db.First(&reloaded, "id = ?", "conversation-rebind").Error; err != nil {
		t.Fatalf("reload conversation: %v", err)
	}
	if reloaded.Version != 1 {
		t.Fatalf("no-op rebind advanced version to %d, want 1", reloaded.Version)
	}
}

func TestRebindConversationRuntimeRejectsUnknownConversation(t *testing.T) {
	openConversationAuthorityDB(t, "runtime_rebind_missing")

	_, err := NewConversationService().RebindConversationRuntime(
		context.Background(),
		rebindTestActorPTID,
		"conversation-missing",
		1,
	)
	assertBizErrorCode(t, err, errcode.AgentNotFound)
}
