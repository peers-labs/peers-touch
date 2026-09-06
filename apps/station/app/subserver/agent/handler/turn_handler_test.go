package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type turnHandlerTestStore struct{}

func (*turnHandlerTestStore) Init(context.Context, ...option.Option) error {
	return nil
}

func (*turnHandlerTestStore) RDS(
	context.Context,
	...store.RDSDMLOption,
) (*gorm.DB, error) {
	return turnHandlerTestDB, nil
}

func (*turnHandlerTestStore) Name() string {
	return "turn-handler-test"
}

var turnHandlerTestStoreOnce sync.Once
var turnHandlerTestDB *gorm.DB

func openTurnHandlerTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+name+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open turn handler database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Agent{},
		&persistence.Conversation{},
	); err != nil {
		t.Fatalf("migrate turn handler database: %v", err)
	}
	turnHandlerTestDB = db
	var injectErr error
	turnHandlerTestStoreOnce.Do(func() {
		injectErr = store.InjectStore(
			context.Background(),
			&turnHandlerTestStore{},
		)
	})
	if injectErr != nil {
		t.Fatalf("inject turn handler store: %v", injectErr)
	}
	return db
}

type fakeTurnRequest struct {
	body []byte
}

func (r *fakeTurnRequest) Context() context.Context  { return context.Background() }
func (r *fakeTurnRequest) Header() map[string]string { return map[string]string{} }
func (r *fakeTurnRequest) Method() server.Method     { return server.POST }
func (r *fakeTurnRequest) Path() string              { return "/agent/turns/stream" }
func (r *fakeTurnRequest) Body() []byte              { return r.body }

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

func TestWriteTurnStreamErrorPreservesTypedAttachmentPayload(t *testing.T) {
	resp := &fakeStreamResponse{}
	if err := writeTurnStreamError(
		resp,
		errcode.NewAttachmentRejected(
			"attachment-1",
			"attachment_content_does_not_match_mime",
		),
	); err != nil {
		t.Fatalf("write typed stream error: %v", err)
	}

	body := resp.body.String()
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(body, "\n")[1]),
		"data: ",
	)
	var payload struct {
		Type      string            `json:"type"`
		Error     string            `json:"error"`
		ErrorType string            `json:"error_type"`
		LocaleKey string            `json:"locale_key"`
		Retryable bool              `json:"retryable"`
		Terminal  bool              `json:"terminal"`
		Details   map[string]string `json:"details"`
	}
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode typed stream error: %v", err)
	}
	if payload.Type != "error" ||
		payload.Error != errcode.AgentAttachmentRejectedLocaleKey ||
		payload.ErrorType != string(errcode.AgentAttachmentRejected) ||
		payload.LocaleKey != errcode.AgentAttachmentRejectedLocaleKey ||
		payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 2 ||
		payload.Details["attachment_id"] != "attachment-1" ||
		payload.Details["reason_code"] != "attachment_content_does_not_match_mime" {
		t.Fatalf("typed stream error payload = %+v", payload)
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

func TestExecuteTurnPreflightsBeforeCreatingMissingConversation(t *testing.T) {
	db := openTurnHandlerTestDB(t, "turn_handler_missing_conversation_sync")
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:person:owner"},
	)
	handlers := NewTurnHandlers(
		&service.TurnService{},
		service.NewToolRegistryService(nil, nil),
		nil,
		service.NewConversationService(),
	)

	_, err := handlers.HandleExecuteTurn(ctx, &model.ExecuteTurnRequest{
		ConversationId: "missing-sync-conversation",
		AgentId:        "agent-1",
		UserInput:      "must preflight",
		Provider:       stringPointer("test-provider"),
		Model:          stringPointer("test-model"),
	})
	if err == nil || !strings.Contains(err.Error(), "runtime admission authority is required") {
		t.Fatalf("missing conversation preflight error = %v", err)
	}
	assertConversationNotCreated(t, db, "missing-sync-conversation")
	_, err = handlers.HandleExecuteTurn(ctx, &model.ExecuteTurnRequest{
		AgentId:   "agent-1",
		UserInput: "must preflight generated conversation",
		Provider:  stringPointer("test-provider"),
		Model:     stringPointer("test-model"),
	})
	if err == nil || !strings.Contains(err.Error(), "runtime admission authority is required") {
		t.Fatalf("generated conversation preflight error = %v", err)
	}
	assertConversationCount(t, db, 0)
}

func TestExecuteTurnStreamPreflightsBeforeCreatingMissingConversation(t *testing.T) {
	db := openTurnHandlerTestDB(t, "turn_handler_missing_conversation_stream")
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:person:owner"},
	)
	handlers := NewTurnHandlers(
		&service.TurnService{},
		service.NewToolRegistryService(nil, nil),
		nil,
		service.NewConversationService(),
	)
	requestBody, err := protojson.Marshal(&model.ExecuteTurnRequest{
		ConversationId: "missing-stream-conversation",
		AgentId:        "agent-1",
		UserInput:      "must preflight",
		Provider:       stringPointer("test-provider"),
		Model:          stringPointer("test-model"),
	})
	if err != nil {
		t.Fatalf("encode stream request: %v", err)
	}
	response := &fakeStreamResponse{}
	if err := handlers.HandleExecuteTurnStream(
		ctx,
		&fakeTurnRequest{body: requestBody},
		response,
	); err != nil {
		t.Fatalf("execute stream handler: %v", err)
	}
	if !strings.Contains(
		response.body.String(),
		"runtime admission authority is required",
	) {
		t.Fatalf("stream preflight response = %q", response.body.String())
	}
	assertConversationNotCreated(t, db, "missing-stream-conversation")
	generatedRequestBody, err := protojson.Marshal(&model.ExecuteTurnRequest{
		AgentId:   "agent-1",
		UserInput: "must preflight generated conversation",
		Provider:  stringPointer("test-provider"),
		Model:     stringPointer("test-model"),
	})
	if err != nil {
		t.Fatalf("encode generated stream request: %v", err)
	}
	generatedResponse := &fakeStreamResponse{}
	if err := handlers.HandleExecuteTurnStream(
		ctx,
		&fakeTurnRequest{body: generatedRequestBody},
		generatedResponse,
	); err != nil {
		t.Fatalf("execute generated stream handler: %v", err)
	}
	if !strings.Contains(
		generatedResponse.body.String(),
		"runtime admission authority is required",
	) {
		t.Fatalf(
			"generated stream preflight response = %q",
			generatedResponse.body.String(),
		)
	}
	assertConversationCount(t, db, 0)
}

func assertConversationNotCreated(t *testing.T, db *gorm.DB, conversationID string) {
	t.Helper()
	var count int64
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", conversationID).
		Count(&count).Error; err != nil {
		t.Fatalf("count conversations: %v", err)
	}
	if count != 0 {
		t.Fatalf("preflight rejection persisted conversation %q", conversationID)
	}
}

func assertConversationCount(t *testing.T, db *gorm.DB, want int64) {
	t.Helper()
	var count int64
	if err := db.Model(&persistence.Conversation{}).Count(&count).Error; err != nil {
		t.Fatalf("count all conversations: %v", err)
	}
	if count != want {
		t.Fatalf("conversation count = %d, want %d", count, want)
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
