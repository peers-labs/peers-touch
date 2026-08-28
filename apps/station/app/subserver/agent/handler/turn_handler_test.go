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
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
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

func TestDecodeExecuteTurnRequestAcceptsProtoTimestampAttachment(t *testing.T) {
	var request model.ExecuteTurnRequest
	err := decodeExecuteTurnRequest([]byte(`{
		"conversation_id":"conversation-1",
		"agent_id":"agent-1",
		"user_input":"inspect",
		"attachments":[{
			"attachment_id":"attachment-1",
			"object_ref":"oss:cas/01/object",
			"mime_type":"image/png",
			"size_bytes":"8",
			"checksum":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"filename":"image.png",
			"authorization_scope":"conversation:conversation-1",
			"expires_at":"2026-08-29T00:00:00Z"
		}]
	}`), &request)
	if err != nil {
		t.Fatalf("decode ExecuteTurnRequest: %v", err)
	}
	if len(request.GetAttachments()) != 1 ||
		request.GetAttachments()[0].GetExpiresAt() == nil ||
		request.GetAttachments()[0].GetExpiresAt().AsTime().UTC().Format(time.RFC3339) != "2026-08-29T00:00:00Z" {
		t.Fatalf("attachment timestamp was not decoded: %+v", request.GetAttachments())
	}
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

func TestTurnConfigFromRequestDoesNotAcceptKnowledgeAuthority(t *testing.T) {
	handlers := NewTurnHandlers(&service.TurnService{}, service.NewToolRegistryService(nil, nil), nil, nil)
	config, err := handlers.turnConfigFromRequest(context.Background(), &model.ExecuteTurnRequest{
		ConversationId: "conv_1",
		AgentId:        "agent_1",
		UserInput:      "How do traces work?",
		ThinkingMode:   "disabled",
		RequestedBudget: &model.RuntimeBudget{
			MaxToolCalls:          2,
			MaxIdenticalToolCalls: 1,
		},
	}, nil)
	if err != nil {
		t.Fatalf("map turn config: %v", err)
	}

	if config.ThinkingMode != domain.ThinkingModeDisabled {
		t.Fatalf("expected disabled thinking mode, got %q", config.ThinkingMode)
	}
	if config.AuthorizedCapabilities != nil {
		t.Fatal("handler must not manufacture an authorized capability set")
	}
	var requested model.RuntimeBudget
	if err := protojson.Unmarshal(config.RequestedBudgetJSON, &requested); err != nil {
		t.Fatalf("decode requested runtime budget: %v", err)
	}
	if requested.GetMaxToolCalls() != 2 || requested.GetMaxIdenticalToolCalls() != 1 {
		t.Fatalf("requested runtime budget was not mapped: %+v", &requested)
	}
}

func TestHasLegacyTurnKnowledge(t *testing.T) {
	legacyWire := protowire.AppendTag(nil, 13, protowire.BytesType)
	legacyWire = protowire.AppendBytes(legacyWire, []byte{1})
	normalWire := protowire.AppendTag(nil, 1, protowire.BytesType)
	normalWire = protowire.AppendString(normalWire, "conversation-1")

	tests := []struct {
		name        string
		contentType string
		body        []byte
		want        bool
	}{
		{
			name:        "snake case JSON",
			contentType: "application/json",
			body:        []byte(`{"knowledge_resources":[{"resource_id":"legacy"}]}`),
			want:        true,
		},
		{
			name:        "camel case JSON",
			contentType: "application/json",
			body:        []byte(`{"knowledgeResources":[{"resourceId":"legacy"}]}`),
			want:        true,
		},
		{
			name:        "either alias non-empty",
			contentType: "application/json",
			body: []byte(
				`{"knowledge_resources":[],"knowledgeResources":[{"resourceId":"legacy"}]}`,
			),
			want: true,
		},
		{
			name:        "empty JSON array",
			contentType: "application/json",
			body:        []byte(`{"knowledge_resources":[]}`),
			want:        false,
		},
		{
			name:        "protobuf field 13",
			contentType: "application/x-protobuf",
			body:        legacyWire,
			want:        true,
		},
		{
			name:        "protobuf without field 13",
			contentType: "application/x-protobuf",
			body:        normalWire,
			want:        false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := hasLegacyTurnKnowledge(test.contentType, test.body); got != test.want {
				t.Fatalf("hasLegacyTurnKnowledge() = %t, want %t", got, test.want)
			}
		})
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
