package handler

import (
	"bytes"
	"context"
	"errors"
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
	headers  map[string]string
	body     bytes.Buffer
	status   int
	flushed  bool
	writeErr error
	flushErr error
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
	if r.writeErr != nil {
		return 0, r.writeErr
	}
	return r.body.Write(data)
}

func (r *fakeStreamResponse) Flush() error {
	r.flushed = true
	return r.flushErr
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

func TestExposeTurnStreamIdentityFlushesDurableTurnID(t *testing.T) {
	resp := &fakeStreamResponse{}

	if err := exposeTurnStreamIdentity(resp, " turn-1 "); err != nil {
		t.Fatalf("expose turn stream identity: %v", err)
	}

	if resp.headers["X-Agent-Turn-ID"] != "turn-1" {
		t.Fatalf("turn identity header = %q", resp.headers["X-Agent-Turn-ID"])
	}
	if !resp.flushed {
		t.Fatal("turn identity header was not flushed before stream execution")
	}
}

func TestExposeTurnStreamIdentityReturnsFlushFailure(t *testing.T) {
	flushErr := errors.New("client disconnected")
	resp := &fakeStreamResponse{flushErr: flushErr}

	if err := exposeTurnStreamIdentity(resp, "turn-1"); !errors.Is(err, flushErr) {
		t.Fatalf("turn identity flush error = %v, want disconnect", err)
	}
}

func TestDrainTurnStreamEventsPreservesCommittedTerminalSequence(t *testing.T) {
	resp := &fakeStreamResponse{}
	events := make(chan service.TurnEvent, 4)
	events <- service.TurnEvent{Type: "text", Text: "first", Seq: 1}
	events <- service.TurnEvent{Type: "text", Text: "second", Seq: 2}
	events <- service.TurnEvent{Type: "progress", Stage: "settling", Seq: 3}
	events <- service.TurnEvent{Type: "done", Stage: "turn_completed", Seq: 4}
	close(events)

	if err := drainTurnStreamEvents(resp, events); err != nil {
		t.Fatalf("drain queued events: %v", err)
	}
	body := resp.body.String()
	first := strings.Index(body, `"seq":1`)
	second := strings.Index(body, `"seq":2`)
	settling := strings.Index(body, `"seq":3`)
	done := strings.LastIndex(body, "event: done\n")
	terminalSequence := strings.LastIndex(body, `"seq":4`)
	if first < 0 || second <= first || settling <= second || done <= settling || terminalSequence <= done {
		t.Fatalf("queued frames were not drained before terminal frame: %q", body)
	}
}

func TestDrainTurnStreamEventsStopsOnDisconnectedClient(t *testing.T) {
	events := make(chan service.TurnEvent, 1)
	events <- service.TurnEvent{Type: "text", Text: "unwritable", Seq: 1}
	close(events)
	disconnectErr := errors.New("client disconnected")
	resp := &fakeStreamResponse{writeErr: disconnectErr}

	if err := drainTurnStreamEvents(resp, events); !errors.Is(err, disconnectErr) {
		t.Fatalf("drain error = %v, want client disconnect", err)
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
