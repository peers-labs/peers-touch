package handler

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type fakeStreamResponse struct {
	headers map[string]string
	body    bytes.Buffer
	status  int
	flushed bool
}

func (r *fakeStreamResponse) Header() map[string]string {
	if r.headers == nil {
		r.headers = map[string]string{}
	}
	return r.headers
}

func (r *fakeStreamResponse) SetHeader(key, value string) {
	r.Header()[key] = value
}

func (r *fakeStreamResponse) Write(data []byte) (int, error) {
	return r.body.Write(data)
}

func (r *fakeStreamResponse) Flush() error {
	r.flushed = true
	return nil
}

func (r *fakeStreamResponse) WriteHeader(status int) {
	r.status = status
}

func (r *fakeStreamResponse) Status() int {
	return r.status
}

func TestWriteTurnStreamEvent(t *testing.T) {
	resp := &fakeStreamResponse{}

	if err := writeTurnStreamEvent(resp, "progress", map[string]any{
		"type":  "progress",
		"stage": "turn_started",
	}); err != nil {
		t.Fatalf("writeTurnStreamEvent returned error: %v", err)
	}

	body := resp.body.String()
	if !strings.Contains(body, "event: progress\n") {
		t.Fatalf("expected progress event frame, got %q", body)
	}
	if !strings.Contains(body, `"stage":"turn_started"`) {
		t.Fatalf("expected JSON data frame, got %q", body)
	}
	if !strings.HasSuffix(body, "\n\n") {
		t.Fatalf("expected SSE frame terminator, got %q", body)
	}
	if !resp.flushed {
		t.Fatal("expected SSE frame to flush")
	}
}

func TestDomainTurnStatusToProtoProjectsLocalToolWaitAsRunning(t *testing.T) {
	if got := domainTurnStatusToProto(domain.TurnStatusWaitingLocalTool); got != model.TurnStatus_TURN_STATUS_RUNNING {
		t.Fatalf("waiting local tool must remain a non-terminal running projection, got %s", got)
	}
}

func TestTurnConfigFromRequestCarriesKnowledgeResources(t *testing.T) {
	handlers := NewTurnHandlers(&service.TurnService{}, service.NewToolRegistryService(nil, nil), nil, nil)
	config := handlers.turnConfigFromRequest(context.Background(), &model.ExecuteTurnRequest{
		ConversationId: "conv_1",
		AgentId:        "agent_1",
		UserInput:      "How do traces work?",
		ThinkingMode:   "disabled",
		KnowledgeResources: []*model.KnowledgeResource{{
			ResourceId: "kr_1",
			AgentId:    "agent_1",
			Type:       model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_DOCUMENT,
			Title:      "Trace Guide",
			Source:     "trace content",
			Policy:     model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_ALWAYS,
			Status:     model.KnowledgeResourceStatus_KNOWLEDGE_RESOURCE_STATUS_BOUND,
		}},
	}, nil)

	if len(config.KnowledgeResources) != 1 {
		t.Fatalf("expected one knowledge resource, got %d", len(config.KnowledgeResources))
	}
	if config.KnowledgeResources[0].ResourceID != "kr_1" {
		t.Fatalf("expected resource id kr_1, got %q", config.KnowledgeResources[0].ResourceID)
	}
	if config.ThinkingMode != domain.ThinkingModeDisabled {
		t.Fatalf("expected disabled thinking mode, got %q", config.ThinkingMode)
	}
	if config.KnowledgeResources[0].Source != "trace content" {
		t.Fatalf("expected resource source to be preserved, got %q", config.KnowledgeResources[0].Source)
	}
}

func TestConversationReadbackProjectsRuntimeBinding(t *testing.T) {
	binding := &model.ConversationRuntimeBinding{
		RuntimeKind:            model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:             "provider-1",
		ModelId:                "model-1",
		RuntimeProfileId:       "modern-chat-agent-v1",
		CapabilitySnapshotHash: strings.Repeat("a", 64),
		ConfigSnapshotHash:     strings.Repeat("b", 64),
		BoundAt:                timestamppb.New(time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)),
	}
	conversation := &domain.Conversation{
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		Ptid:           "ptid:person:owner",
		RuntimeBinding: binding,
	}

	jsonProjection := conversationToJSON(conversation)
	jsonBinding, ok := jsonProjection["runtime_binding"].(map[string]any)
	if !ok ||
		jsonBinding["provider_id"] != binding.ProviderId ||
		jsonBinding["external_session_id"] != "" ||
		jsonBinding["external_session_epoch"] != uint64(0) {
		t.Fatalf("JSON conversation readback lost runtime binding fields: %+v", jsonProjection)
	}
	protoProjection := revisionConversationToProto(conversation)
	if protoProjection.GetRuntimeBinding().GetCapabilitySnapshotHash() != binding.CapabilitySnapshotHash {
		t.Fatalf("protobuf conversation readback lost runtime binding: %+v", protoProjection)
	}
}

func TestRevisionAttemptReadbackProjectsStoredRuntimeSnapshot(t *testing.T) {
	snapshot := &model.RuntimeSnapshot{
		RuntimeKind:           model.RuntimeKind_RUNTIME_KIND_DIRECT_MODEL,
		ProviderId:            "provider-1",
		ModelId:               "model-1",
		RuntimeProfileId:      "modern-chat-agent-v1",
		ProviderConfigVersion: "7",
		AgentConfigVersion:    "11",
	}
	encoded, err := persistence.MarshalRuntimeSnapshot(snapshot)
	if err != nil {
		t.Fatalf("encode runtime snapshot: %v", err)
	}
	projected, err := revisionAttemptToProto(&persistence.TurnAttempt{
		ID:              "attempt-1",
		TurnID:          "turn-1",
		AttemptIndex:    1,
		RuntimeSnapshot: encoded,
		Status:          "running",
		StartedAt:       time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("project attempt: %v", err)
	}
	if projected.GetRuntimeSnapshot().GetProviderId() != "provider-1" ||
		projected.GetRuntimeSnapshot().GetAgentConfigVersion() != "11" {
		t.Fatalf("attempt readback lost runtime snapshot: %+v", projected)
	}
}
