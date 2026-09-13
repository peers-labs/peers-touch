package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
		&persistence.AgentMessage{},
		&persistence.AgentTurn{},
		&persistence.TurnQueueEntry{},
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

func TestWriteTurnStreamErrorPreservesAdmissionDuplicatePayload(t *testing.T) {
	resp := &fakeStreamResponse{}
	if err := writeTurnStreamErrorWithIdentity(
		resp,
		errcode.NewAdmissionDuplicateConflict("request-1", "turn-1"),
		"conversation-1",
		"agent-1",
	); err != nil {
		t.Fatalf("write typed stream error: %v", err)
	}

	body := resp.body.String()
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(body, "\n")[1]),
		"data: ",
	)
	var payload struct {
		Error          string            `json:"error"`
		ErrorType      string            `json:"error_type"`
		LocaleKey      string            `json:"locale_key"`
		Retryable      bool              `json:"retryable"`
		Terminal       bool              `json:"terminal"`
		Details        map[string]string `json:"details"`
		ConversationID string            `json:"conversationId"`
		AgentID        string            `json:"agentId"`
	}
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode typed stream error: %v", err)
	}
	if payload.Error != errcode.AgentAdmissionDuplicateConflictLocaleKey ||
		payload.ErrorType != string(errcode.AgentAdmissionDuplicateConflict) ||
		payload.LocaleKey != errcode.AgentAdmissionDuplicateConflictLocaleKey ||
		payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 2 ||
		payload.Details["idempotency_key_hash"] != fmt.Sprintf(
			"%x",
			sha256.Sum256([]byte("request-1")),
		) ||
		payload.Details["existing_command_id"] != "turn-1" ||
		payload.ConversationID != "conversation-1" ||
		payload.AgentID != "agent-1" {
		t.Fatalf("typed stream error payload = %+v", payload)
	}
}

func TestWriteTurnStreamErrorPreservesContextOverflowPayload(t *testing.T) {
	resp := &fakeStreamResponse{}
	if err := writeTurnStreamErrorWithIdentity(
		resp,
		errcode.NewContextOverflow(128, 129),
		"conversation-1",
		"agent-1",
	); err != nil {
		t.Fatalf("write typed stream error: %v", err)
	}

	body := resp.body.String()
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(body, "\n")[1]),
		"data: ",
	)
	var payload struct {
		Error          string            `json:"error"`
		ErrorType      string            `json:"error_type"`
		LocaleKey      string            `json:"locale_key"`
		Retryable      bool              `json:"retryable"`
		Terminal       bool              `json:"terminal"`
		Details        map[string]string `json:"details"`
		ConversationID string            `json:"conversationId"`
		AgentID        string            `json:"agentId"`
	}
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode typed stream error: %v", err)
	}
	if payload.Error != errcode.AgentContextOverflowLocaleKey ||
		payload.ErrorType != string(errcode.AgentContextOverflow) ||
		payload.LocaleKey != errcode.AgentContextOverflowLocaleKey ||
		payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 2 ||
		payload.Details["limit_tokens"] != "128" ||
		payload.Details["actual_tokens"] != "129" ||
		payload.ConversationID != "conversation-1" ||
		payload.AgentID != "agent-1" {
		t.Fatalf("typed stream error payload = %+v", payload)
	}
}

func TestWriteTurnStreamErrorPreservesProviderCredentialMissingPayload(t *testing.T) {
	resp := &fakeStreamResponse{}
	if err := writeTurnStreamErrorWithIdentity(
		resp,
		errcode.NewProviderCredentialMissing("provider-1"),
		"conversation-1",
		"agent-1",
	); err != nil {
		t.Fatalf("write typed stream error: %v", err)
	}

	body := resp.body.String()
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(body, "\n")[1]),
		"data: ",
	)
	var payload struct {
		Error          string            `json:"error"`
		ErrorType      string            `json:"error_type"`
		LocaleKey      string            `json:"locale_key"`
		Retryable      bool              `json:"retryable"`
		Terminal       bool              `json:"terminal"`
		Details        map[string]string `json:"details"`
		ConversationID string            `json:"conversationId"`
		AgentID        string            `json:"agentId"`
	}
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode typed stream error: %v", err)
	}
	if payload.Error != errcode.AgentProviderCredentialMissingLocaleKey ||
		payload.ErrorType != string(errcode.AgentProviderCredentialMissing) ||
		payload.LocaleKey != errcode.AgentProviderCredentialMissingLocaleKey ||
		!payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 1 ||
		payload.Details["provider_id"] != "provider-1" ||
		payload.ConversationID != "conversation-1" ||
		payload.AgentID != "agent-1" {
		t.Fatalf("typed stream error payload = %+v", payload)
	}
}

func TestWriteTurnStreamErrorPreservesRuntimeIncompatibleCapabilityPayload(t *testing.T) {
	resp := &fakeStreamResponse{}
	if err := writeTurnStreamErrorWithIdentity(
		resp,
		errcode.NewRuntimeIncompatibleCapability(
			"tool:skills_list",
			"runtime_capability_unavailable",
		),
		"conversation-1",
		"agent-1",
	); err != nil {
		t.Fatalf("write typed stream error: %v", err)
	}

	body := resp.body.String()
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(body, "\n")[1]),
		"data: ",
	)
	var payload struct {
		Error          string            `json:"error"`
		ErrorType      string            `json:"error_type"`
		LocaleKey      string            `json:"locale_key"`
		Retryable      bool              `json:"retryable"`
		Terminal       bool              `json:"terminal"`
		Details        map[string]string `json:"details"`
		ConversationID string            `json:"conversationId"`
		AgentID        string            `json:"agentId"`
	}
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode typed stream error: %v", err)
	}
	if payload.Error != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
		payload.ErrorType != string(errcode.AgentRuntimeIncompatibleCapability) ||
		payload.LocaleKey != errcode.AgentRuntimeIncompatibleCapabilityLocaleKey ||
		payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 2 ||
		payload.Details["capability_id"] != "tool:skills_list" ||
		payload.Details["reason_code"] != "runtime_capability_unavailable" ||
		payload.ConversationID != "conversation-1" ||
		payload.AgentID != "agent-1" {
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

func TestExecuteTurnRejectsForeignConversationWithoutMutation(t *testing.T) {
	db := openTurnHandlerTestDB(t, "turn_handler_foreign_conversation_sync")
	conversation := seedPrivateTurnHandlerConversation(
		t,
		db,
		"foreign-sync-conversation",
	)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:person:foreign"},
	)
	handlers := NewTurnHandlers(nil, nil, nil, service.NewConversationService())

	response, err := handlers.HandleExecuteTurn(ctx, &model.ExecuteTurnRequest{
		ConversationId: conversation.ID,
		AgentId:        conversation.AgentID,
		UserInput:      "must not cross the ownership boundary",
	})
	if response != nil {
		t.Fatalf("foreign execute returned response: %+v", response)
	}
	var handlerErr *server.HandlerError
	if !errors.As(err, &handlerErr) {
		t.Fatalf("foreign execute error = %T: %v", err, err)
	}
	if handlerErr.Code != http.StatusForbidden ||
		handlerErr.Headers["X-Peers-Error-Code"] != string(errcode.AgentOwnershipForbiddenActor) ||
		handlerErr.Headers["X-Peers-Error-Locale-Key"] != errcode.AgentOwnershipForbiddenActorLocaleKey ||
		handlerErr.Headers["X-Peers-Error-Retryable"] != "false" ||
		handlerErr.Headers["X-Peers-Error-Terminal"] != "true" {
		t.Fatalf("foreign execute typed headers = %+v", handlerErr)
	}
	var details map[string]string
	if err := json.Unmarshal(
		[]byte(handlerErr.Headers[errorDetailsHeader]),
		&details,
	); err != nil {
		t.Fatalf("decode foreign execute details: %v", err)
	}
	if len(details) != 2 ||
		details["resource_kind"] != "conversation" ||
		details["resource_id"] != conversation.ID {
		t.Fatalf("foreign execute details = %+v", details)
	}
	if strings.Contains(err.Error(), conversation.Title) ||
		strings.Contains(err.Error(), *conversation.Description) {
		t.Fatalf("foreign execute exposed owner content: %v", err)
	}
	assertPrivateTurnHandlerConversationUnchanged(t, db, conversation)
}

func TestExecuteTurnStreamRejectsForeignConversationWithTypedPayload(t *testing.T) {
	db := openTurnHandlerTestDB(t, "turn_handler_foreign_conversation_stream")
	conversation := seedPrivateTurnHandlerConversation(
		t,
		db,
		"foreign-stream-conversation",
	)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:person:foreign"},
	)
	handlers := NewTurnHandlers(nil, nil, nil, service.NewConversationService())
	requestBody, err := protojson.Marshal(&model.ExecuteTurnRequest{
		ConversationId: conversation.ID,
		AgentId:        conversation.AgentID,
		UserInput:      "must not cross the ownership boundary",
	})
	if err != nil {
		t.Fatalf("encode foreign stream request: %v", err)
	}
	response := &fakeStreamResponse{}
	if err := handlers.HandleExecuteTurnStream(
		ctx,
		&fakeTurnRequest{body: requestBody},
		response,
	); err != nil {
		t.Fatalf("foreign stream handler: %v", err)
	}

	var payload struct {
		Type           string            `json:"type"`
		Error          string            `json:"error"`
		ErrorType      string            `json:"error_type"`
		LocaleKey      string            `json:"locale_key"`
		Retryable      bool              `json:"retryable"`
		Terminal       bool              `json:"terminal"`
		Details        map[string]string `json:"details"`
		ConversationID string            `json:"conversationId"`
		AgentID        string            `json:"agentId"`
	}
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(response.body.String(), "\n")[1]),
		"data: ",
	)
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode foreign stream payload: %v", err)
	}
	if payload.Type != "error" ||
		payload.Error != errcode.AgentOwnershipForbiddenActorLocaleKey ||
		payload.ErrorType != string(errcode.AgentOwnershipForbiddenActor) ||
		payload.LocaleKey != errcode.AgentOwnershipForbiddenActorLocaleKey ||
		payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 2 ||
		payload.Details["resource_kind"] != "conversation" ||
		payload.Details["resource_id"] != conversation.ID ||
		payload.ConversationID != conversation.ID ||
		payload.AgentID != conversation.AgentID {
		t.Fatalf("foreign stream payload = %+v", payload)
	}
	if response.headers["X-Agent-Turn-ID"] != "" {
		t.Fatalf("foreign stream exposed turn identity: %+v", response.headers)
	}
	if strings.Contains(response.body.String(), conversation.Title) ||
		strings.Contains(response.body.String(), *conversation.Description) {
		t.Fatalf("foreign stream exposed owner content: %q", response.body.String())
	}
	assertPrivateTurnHandlerConversationUnchanged(t, db, conversation)
}

func seedPrivateTurnHandlerConversation(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
) *persistence.Conversation {
	t.Helper()
	description := "owner-only conversation content"
	conversation := &persistence.Conversation{
		ID:          conversationID,
		AgentID:     "agent-private",
		ActorPTID:   "ptid:person:owner",
		Title:       "owner-only title",
		Description: &description,
		ProviderID:  "provider-private",
		Status:      string(domain.ConversationStatusActive),
		Version:     7,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := db.Create(conversation).Error; err != nil {
		t.Fatalf("seed private conversation: %v", err)
	}
	return conversation
}

func assertPrivateTurnHandlerConversationUnchanged(
	t *testing.T,
	db *gorm.DB,
	want *persistence.Conversation,
) {
	t.Helper()
	assertConversationCount(t, db, 1)
	var got persistence.Conversation
	if err := db.First(&got, "id = ?", want.ID).Error; err != nil {
		t.Fatalf("read private conversation after rejection: %v", err)
	}
	if got.ActorPTID != want.ActorPTID ||
		got.AgentID != want.AgentID ||
		got.Title != want.Title ||
		got.Description == nil ||
		*got.Description != *want.Description ||
		got.ProviderID != want.ProviderID ||
		got.Status != want.Status ||
		got.Version != want.Version {
		t.Fatalf("foreign request mutated private conversation: got=%+v want=%+v", got, want)
	}
	for _, resource := range []struct {
		name  string
		model any
	}{
		{name: "message", model: &persistence.AgentMessage{}},
		{name: "turn", model: &persistence.AgentTurn{}},
		{name: "queue entry", model: &persistence.TurnQueueEntry{}},
	} {
		var count int64
		if err := db.Model(resource.model).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows after rejection: %v", resource.name, err)
		}
		if count != 0 {
			t.Fatalf("foreign request persisted %d %s rows", count, resource.name)
		}
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

func TestExecuteTurnStreamRejectsRetiredContextReferenceWithTypedPayloadBeforePersistence(
	t *testing.T,
) {
	db := openTurnHandlerTestDB(t, "turn_handler_invalid_reference_stream")
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
	const token = "@url:https://example.test/private"
	requestBody, err := protojson.Marshal(&model.ExecuteTurnRequest{
		ConversationId: "missing-invalid-reference-conversation",
		AgentId:        "agent-1",
		UserInput:      "Read " + token,
	})
	if err != nil {
		t.Fatalf("encode invalid reference stream request: %v", err)
	}
	response := &fakeStreamResponse{}
	if err := handlers.HandleExecuteTurnStream(
		ctx,
		&fakeTurnRequest{body: requestBody},
		response,
	); err != nil {
		t.Fatalf("execute invalid reference stream handler: %v", err)
	}

	var payload struct {
		Type           string            `json:"type"`
		Error          string            `json:"error"`
		ErrorType      string            `json:"error_type"`
		LocaleKey      string            `json:"locale_key"`
		Retryable      bool              `json:"retryable"`
		Terminal       bool              `json:"terminal"`
		Details        map[string]string `json:"details"`
		ConversationID string            `json:"conversationId"`
		AgentID        string            `json:"agentId"`
	}
	dataLine := strings.TrimPrefix(
		strings.TrimSpace(strings.Split(response.body.String(), "\n")[1]),
		"data: ",
	)
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		t.Fatalf("decode invalid reference stream payload: %v", err)
	}
	referenceHash := sha256.Sum256([]byte(token))
	if payload.Type != "error" ||
		payload.Error != errcode.AgentContextInvalidReferenceLocaleKey ||
		payload.ErrorType != string(errcode.AgentContextInvalidReference) ||
		payload.LocaleKey != errcode.AgentContextInvalidReferenceLocaleKey ||
		payload.Retryable ||
		!payload.Terminal ||
		len(payload.Details) != 2 ||
		payload.Details["reference_kind"] != "url" ||
		payload.Details["reference_hash"] != fmt.Sprintf("%x", referenceHash) ||
		payload.ConversationID != "missing-invalid-reference-conversation" ||
		payload.AgentID != "agent-1" {
		t.Fatalf("invalid reference stream payload = %+v", payload)
	}
	if response.headers["X-Agent-Turn-ID"] != "" {
		t.Fatalf("invalid reference stream exposed turn identity: %+v", response.headers)
	}
	assertNoTurnHandlerPersistence(t, db)
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

func assertNoTurnHandlerPersistence(t *testing.T, db *gorm.DB) {
	t.Helper()

	for name, record := range map[string]interface{}{
		"conversation": &persistence.Conversation{},
		"message":      &persistence.AgentMessage{},
		"turn":         &persistence.AgentTurn{},
		"queue entry":  &persistence.TurnQueueEntry{},
	} {
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("invalid reference persisted %d %s rows", count, name)
		}
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
		ActorPTID:      "ptid:person:owner",
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
