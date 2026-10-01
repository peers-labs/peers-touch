package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/externalruntime"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type externalRuntimeManagerStub struct {
	mu        sync.Mutex
	available bool
	execute   func(
		context.Context,
		externalruntime.ExecuteRequest,
		externalruntime.DeltaSink,
		externalruntime.SessionSink,
		externalruntime.ActivitySink,
	) (*externalruntime.ExecuteResult, error)
	cleanup      func(context.Context, externalruntime.CleanupRequest) error
	cleanupErr   error
	executions   []externalruntime.ExecuteRequest
	cleanupCalls []externalruntime.CleanupRequest
}

func (s *externalRuntimeManagerStub) Available() bool {
	return s != nil && s.available
}

func (s *externalRuntimeManagerStub) Execute(
	ctx context.Context,
	request externalruntime.ExecuteRequest,
	deltaSink externalruntime.DeltaSink,
	sessionSink externalruntime.SessionSink,
	activitySink externalruntime.ActivitySink,
) (*externalruntime.ExecuteResult, error) {
	s.mu.Lock()
	s.executions = append(s.executions, request)
	execute := s.execute
	s.mu.Unlock()
	if execute == nil {
		return nil, errors.New("unexpected execute")
	}
	return execute(ctx, request, deltaSink, sessionSink, activitySink)
}

func (s *externalRuntimeManagerStub) Cleanup(
	ctx context.Context,
	request externalruntime.CleanupRequest,
) error {
	s.mu.Lock()
	s.cleanupCalls = append(s.cleanupCalls, request)
	cleanup := s.cleanup
	cleanupErr := s.cleanupErr
	s.mu.Unlock()
	if cleanup != nil {
		return cleanup(ctx, request)
	}
	return cleanupErr
}

func TestExternalRuntimeSessionPersistsBeforeOutputAndResumesAfterRestart(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "session-before-output")
	seedExternalRuntimeConversation(t, db, "conversation-1", "", 1, 4)
	seedExternalRuntimeAttempt(t, db, "conversation-1", "turn-1", "attempt-1", "", 1)

	manager := &externalRuntimeManagerStub{available: true}
	manager.execute = func(
		ctx context.Context,
		request externalruntime.ExecuteRequest,
		deltaSink externalruntime.DeltaSink,
		sessionSink externalruntime.SessionSink,
		_ externalruntime.ActivitySink,
	) (*externalruntime.ExecuteResult, error) {
		if request.SessionID != "" || request.SessionEpoch != 1 {
			t.Fatalf("first execution binding = %+v", request)
		}
		if err := sessionSink(ctx, "session-1"); err != nil {
			return nil, err
		}
		binding := loadExternalRuntimeBinding(t, db, "conversation-1")
		if binding.GetExternalSessionId() != "session-1" {
			t.Fatalf("session was not durable before output: %+v", binding)
		}
		if err := deltaSink(ctx, externalruntime.Delta{
			Type:    "text",
			Content: "hello",
		}); err != nil {
			return nil, err
		}
		return &externalruntime.ExecuteResult{
			SessionID: "session-1",
			Content:   "hello",
			Streamed:  true,
		}, nil
	}
	service := NewExternalRuntimeService(db, manager, nil, nil)
	result, err := service.ExecuteTurn(
		context.Background(),
		externalTurnRequest("conversation-1", "attempt-1", "first"),
		func(context.Context, externalruntime.Delta) error { return nil },
	)
	if err != nil {
		t.Fatalf("execute first external Turn: %v", err)
	}
	if result.SessionID != "session-1" || result.Content != "hello" {
		t.Fatalf("first external result = %+v", result)
	}

	seedExternalRuntimeAttempt(
		t,
		db,
		"conversation-1",
		"turn-2",
		"attempt-2",
		"session-1",
		1,
	)
	restartedManager := &externalRuntimeManagerStub{available: true}
	restartedManager.execute = func(
		_ context.Context,
		request externalruntime.ExecuteRequest,
		_ externalruntime.DeltaSink,
		_ externalruntime.SessionSink,
		_ externalruntime.ActivitySink,
	) (*externalruntime.ExecuteResult, error) {
		if request.SessionID != "session-1" || request.SessionEpoch != 1 {
			t.Fatalf("restart did not resume the persisted binding: %+v", request)
		}
		return &externalruntime.ExecuteResult{
			SessionID: "session-1",
			Content:   "follow-up",
		}, nil
	}
	restartedService := NewExternalRuntimeService(
		db,
		restartedManager,
		nil,
		nil,
	)
	if _, err := restartedService.ExecuteTurn(
		context.Background(),
		externalTurnRequest("conversation-1", "attempt-2", "follow-up"),
		nil,
	); err != nil {
		t.Fatalf("resume external Turn after restart: %v", err)
	}
}

func TestExternalRuntimeResumeFailurePreservesBindingAndRequiresReset(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "resume-unavailable")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 3, 8)
	seedExternalRuntimeAttempt(
		t,
		db,
		"conversation-1",
		"turn-1",
		"attempt-1",
		"session-old",
		3,
	)
	manager := &externalRuntimeManagerStub{
		available: true,
		execute: func(
			context.Context,
			externalruntime.ExecuteRequest,
			externalruntime.DeltaSink,
			externalruntime.SessionSink,
			externalruntime.ActivitySink,
		) (*externalruntime.ExecuteResult, error) {
			return nil, &externalruntime.ExecutionError{
				Kind: externalruntime.FailureResumeUnavailable,
			}
		},
	}
	service := NewExternalRuntimeService(db, manager, nil, nil)
	_, err := service.ExecuteTurn(
		context.Background(),
		externalTurnRequest("conversation-1", "attempt-1", "resume"),
		nil,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentRuntimeResumeUnavailable {
		t.Fatalf("resume error = %T %v", err, err)
	}
	binding := loadExternalRuntimeBinding(t, db, "conversation-1")
	if binding.GetState() !=
		model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_RESUME_UNAVAILABLE ||
		binding.GetExternalSessionId() != "session-old" ||
		binding.GetExternalSessionEpoch() != 3 ||
		binding.GetRuntimeHomeRef() != externalHomeRef(t, "conversation-1", 3) {
		t.Fatalf("resume failure mutated the old tuple: %+v", binding)
	}
	err = service.ValidateTurnAdmission(
		context.Background(),
		"ptid:person:owner",
		"conversation-1",
		model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
	)
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentRuntimeResumeUnavailable {
		t.Fatalf("blocked follow-up error = %T %v", err, err)
	}
}

func TestExternalRuntimeResetIsFencedIdempotentAndAdvancesOneEpoch(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "reset-idempotent")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 3, 8)
	manager := &externalRuntimeManagerStub{available: true}
	service := NewExternalRuntimeService(db, manager, nil, &ConversationService{})
	request := &model.ResetConversationRuntimeRequest{
		ConversationId:              "conversation-1",
		ExpectedConversationVersion: 8,
		ClientIdempotencyKey:        "reset-1",
		DestructiveConfirmed:        true,
	}

	result, err := service.ResetConversationRuntime(
		context.Background(),
		"ptid:person:owner",
		request,
	)
	if err != nil {
		t.Fatalf("reset external runtime: %v", err)
	}
	if result.ClosedEpoch != 3 || result.Replayed ||
		result.Conversation.Version != 9 {
		t.Fatalf("reset result = %+v", result)
	}
	binding := result.Conversation.RuntimeBinding
	if binding.GetExternalSessionEpoch() != 4 ||
		binding.GetExternalSessionId() != "" ||
		binding.GetRuntimeHomeRef() != externalHomeRef(t, "conversation-1", 4) ||
		binding.GetState() !=
			model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_READY {
		t.Fatalf("reset binding = %+v", binding)
	}
	if len(manager.cleanupCalls) != 1 ||
		manager.cleanupCalls[0].SessionID != "session-old" {
		t.Fatalf("cleanup calls = %+v", manager.cleanupCalls)
	}
	var command persistence.ExternalRuntimeResetCommand
	if err := db.Where("idempotency_key = ?", request.ClientIdempotencyKey).
		First(&command).Error; err != nil {
		t.Fatalf("load reset command: %v", err)
	}
	if len(command.ID) > 36 {
		t.Fatalf("reset command id length = %d, want <= 36", len(command.ID))
	}
	var event persistence.TurnEvent
	if err := db.Where(
		"conversation_id = ? AND event_type = ?",
		request.ConversationId,
		"runtime_reset",
	).First(&event).Error; err != nil {
		t.Fatalf("load runtime reset event: %v", err)
	}
	if event.TurnID != command.ID {
		t.Fatalf("runtime reset event turn id = %q, want %q", event.TurnID, command.ID)
	}

	replay, err := service.ResetConversationRuntime(
		context.Background(),
		"ptid:person:owner",
		request,
	)
	if err != nil {
		t.Fatalf("replay reset: %v", err)
	}
	if !replay.Replayed || replay.ClosedEpoch != 3 ||
		replay.Conversation.Version != 9 ||
		len(manager.cleanupCalls) != 1 {
		t.Fatalf("reset replay = %+v cleanup=%+v", replay, manager.cleanupCalls)
	}

	conflict := *request
	conflict.ExpectedConversationVersion = 9
	_, err = service.ResetConversationRuntime(
		context.Background(),
		"ptid:person:owner",
		&conflict,
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentIdempotencyConflict {
		t.Fatalf("conflicting reset replay = %T %v", err, err)
	}
}

func TestExternalRuntimeResetSerializesConcurrentIdempotentReplay(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "reset-concurrent-replay")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 3, 8)
	cleanupStarted := make(chan struct{})
	releaseCleanup := make(chan struct{})
	var startedOnce sync.Once
	manager := &externalRuntimeManagerStub{
		available: true,
		cleanup: func(
			ctx context.Context,
			_ externalruntime.CleanupRequest,
		) error {
			startedOnce.Do(func() { close(cleanupStarted) })
			select {
			case <-releaseCleanup:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
	}
	service := NewExternalRuntimeService(db, manager, nil, &ConversationService{})
	request := &model.ResetConversationRuntimeRequest{
		ConversationId:              "conversation-1",
		ExpectedConversationVersion: 8,
		ClientIdempotencyKey:        "reset-concurrent",
		DestructiveConfirmed:        true,
	}
	type resetOutcome struct {
		result *ExternalRuntimeResetResult
		err    error
	}
	outcomes := make(chan resetOutcome, 2)
	reset := func() {
		result, err := service.ResetConversationRuntime(
			context.Background(),
			"ptid:person:owner",
			request,
		)
		outcomes <- resetOutcome{result: result, err: err}
	}

	go reset()
	<-cleanupStarted
	go reset()
	time.Sleep(100 * time.Millisecond)
	manager.mu.Lock()
	cleanupCallCount := len(manager.cleanupCalls)
	manager.mu.Unlock()
	if cleanupCallCount != 1 {
		t.Fatalf("concurrent cleanup calls before release = %d, want 1", cleanupCallCount)
	}
	close(releaseCleanup)

	first := <-outcomes
	second := <-outcomes
	for _, outcome := range []resetOutcome{first, second} {
		if outcome.err != nil {
			t.Fatalf("concurrent reset error = %v", outcome.err)
		}
		if outcome.result == nil ||
			outcome.result.Conversation.Version != 9 ||
			outcome.result.Conversation.RuntimeBinding.GetExternalSessionEpoch() != 4 {
			t.Fatalf("concurrent reset result = %+v", outcome.result)
		}
	}
	if first.result.Replayed == second.result.Replayed {
		t.Fatalf(
			"concurrent replay flags = %v, %v; want one committed result and one replay",
			first.result.Replayed,
			second.result.Replayed,
		)
	}
	manager.mu.Lock()
	cleanupCallCount = len(manager.cleanupCalls)
	manager.mu.Unlock()
	if cleanupCallCount != 1 {
		t.Fatalf("concurrent cleanup calls = %d, want 1", cleanupCallCount)
	}
}

func TestPrepareConversationDeletionCleansExternalRuntimeExactlyOnce(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "delete-cleanup")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 3, 8)
	manager := &externalRuntimeManagerStub{available: true}
	service := NewExternalRuntimeService(db, manager, nil, nil)

	version, err := service.PrepareConversationDeletion(
		context.Background(),
		"ptid:person:owner",
		"conversation-1",
		8,
	)
	if err != nil {
		t.Fatalf("prepare conversation deletion: %v", err)
	}
	if version != 9 || len(manager.cleanupCalls) != 1 {
		t.Fatalf("prepare result version=%d cleanup=%+v", version, manager.cleanupCalls)
	}

	replayedVersion, err := service.PrepareConversationDeletion(
		context.Background(),
		"ptid:person:owner",
		"conversation-1",
		8,
	)
	if err != nil {
		t.Fatalf("replay conversation deletion preparation: %v", err)
	}
	if replayedVersion != version || len(manager.cleanupCalls) != 1 {
		t.Fatalf(
			"replay version=%d cleanup=%+v",
			replayedVersion,
			manager.cleanupCalls,
		)
	}
}

func TestPrepareConversationDeletionPreservesBindingAfterCleanupFailure(
	t *testing.T,
) {
	db := openExternalRuntimeServiceDB(t, "delete-cleanup-failure")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 2, 5)
	manager := &externalRuntimeManagerStub{
		available:  true,
		cleanupErr: &externalruntime.ExecutionError{Kind: externalruntime.FailureCleanup},
	}
	service := NewExternalRuntimeService(db, manager, nil, nil)

	if _, err := service.PrepareConversationDeletion(
		context.Background(),
		"ptid:person:owner",
		"conversation-1",
		5,
	); err == nil {
		t.Fatal("cleanup failure unexpectedly allowed deletion")
	}
	binding := loadExternalRuntimeBinding(t, db, "conversation-1")
	if binding.GetState() !=
		model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED ||
		binding.GetExternalSessionId() != "session-old" ||
		binding.GetExternalSessionEpoch() != 2 {
		t.Fatalf("cleanup failure mutated the old binding: %+v", binding)
	}
	var row persistence.Conversation
	if err := db.Where("id = ?", "conversation-1").First(&row).Error; err != nil {
		t.Fatalf("load conversation after cleanup failure: %v", err)
	}
	if row.Status == string(domain.ConversationStatusDeleted) {
		t.Fatal("cleanup failure deleted the conversation")
	}
}

func TestExternalRuntimeCleanupFailureIsDurableAndRetryable(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "cleanup-retry")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 2, 5)
	manager := &externalRuntimeManagerStub{
		available:  true,
		cleanupErr: &externalruntime.ExecutionError{Kind: externalruntime.FailureCleanup},
	}
	service := NewExternalRuntimeService(db, manager, nil, nil)
	request := &model.ResetConversationRuntimeRequest{
		ConversationId:              "conversation-1",
		ExpectedConversationVersion: 5,
		ClientIdempotencyKey:        "reset-retry",
		DestructiveConfirmed:        true,
	}
	if _, err := service.ResetConversationRuntime(
		context.Background(),
		"ptid:person:owner",
		request,
	); err == nil {
		t.Fatal("cleanup failure unexpectedly succeeded")
	}
	failed := loadExternalRuntimeBinding(t, db, "conversation-1")
	if failed.GetState() !=
		model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED ||
		failed.GetExternalSessionId() != "session-old" ||
		failed.GetExternalSessionEpoch() != 2 {
		t.Fatalf("cleanup failure lost the old binding: %+v", failed)
	}

	manager.cleanupErr = nil
	result, err := service.ResetConversationRuntime(
		context.Background(),
		"ptid:person:owner",
		request,
	)
	if err != nil {
		t.Fatalf("retry cleanup: %v", err)
	}
	if result.Conversation.RuntimeBinding.GetExternalSessionEpoch() != 3 ||
		len(manager.cleanupCalls) != 2 {
		t.Fatalf("cleanup retry result=%+v calls=%+v", result, manager.cleanupCalls)
	}
}

func TestExternalRuntimeResetRejectsActiveTurnBeforeCleanup(t *testing.T) {
	db := openExternalRuntimeServiceDB(t, "reset-active-turn")
	seedExternalRuntimeConversation(t, db, "conversation-1", "session-old", 1, 3)
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn-active",
		ConversationID: "conversation-1",
		AgentID:        "agent-1",
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed active Turn: %v", err)
	}
	manager := &externalRuntimeManagerStub{available: true}
	service := NewExternalRuntimeService(db, manager, nil, nil)
	_, err := service.ResetConversationRuntime(
		context.Background(),
		"ptid:person:owner",
		&model.ResetConversationRuntimeRequest{
			ConversationId:              "conversation-1",
			ExpectedConversationVersion: 3,
			ClientIdempotencyKey:        "reset-active",
			DestructiveConfirmed:        true,
		},
	)
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentActiveDependency ||
		len(manager.cleanupCalls) != 0 {
		t.Fatalf("active reset error=%T %v cleanup=%+v", err, err, manager.cleanupCalls)
	}
}

func openExternalRuntimeServiceDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", name)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open external runtime database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Conversation{},
		&persistence.AgentTurn{},
		&persistence.TurnAttempt{},
		&persistence.TurnQueueEntry{},
		&persistence.ToolCall{},
		&persistence.ExternalRuntimeResetCommand{},
		&persistence.TurnEvent{},
	); err != nil {
		t.Fatalf("migrate external runtime database: %v", err)
	}
	return db
}

func seedExternalRuntimeConversation(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
	sessionID string,
	epoch uint64,
	version uint64,
) {
	t.Helper()
	now := time.Now().UTC()
	binding := &model.ConversationRuntimeBinding{
		RuntimeKind:          model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
		ProviderId:           "external-agent",
		ModelId:              "default",
		RuntimeProfileId:     modernChatAgentProfileID,
		ExternalSessionId:    sessionID,
		ExternalSessionEpoch: epoch,
		RuntimeHomeRef:       externalHomeRef(t, conversationID, epoch),
		State:                model.ExternalRuntimeBindingState_EXTERNAL_RUNTIME_BINDING_STATE_READY,
		BoundAt:              timestamppb.New(now),
		UpdatedAt:            timestamppb.New(now),
	}
	encoded, err := persistence.MarshalConversationRuntimeBinding(binding)
	if err != nil {
		t.Fatalf("encode external runtime binding: %v", err)
	}
	if err := db.Create(&persistence.Conversation{
		ID:             conversationID,
		AgentID:        "agent-1",
		ActorPTID:      "ptid:person:owner",
		Title:          "External runtime",
		ProviderID:     "external-agent",
		ModelName:      stringPtr("default"),
		Status:         string(domain.ConversationStatusActive),
		RuntimeBinding: encoded,
		Version:        version,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed external runtime conversation: %v", err)
	}
}

func seedExternalRuntimeAttempt(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
	turnID string,
	attemptID string,
	sessionID string,
	epoch uint64,
) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.AgentTurn{
		ID:             turnID,
		ConversationID: conversationID,
		AgentID:        "agent-1",
		Status:         string(domain.TurnStatusCompleted),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed external runtime Turn: %v", err)
	}
	snapshot := &model.RuntimeSnapshot{
		RuntimeKind:          model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT,
		ProviderId:           "external-agent",
		ModelId:              "default",
		RuntimeProfileId:     modernChatAgentProfileID,
		ExternalSessionId:    sessionID,
		ExternalSessionEpoch: epoch,
	}
	encoded, err := persistence.MarshalRuntimeSnapshot(snapshot)
	if err != nil {
		t.Fatalf("encode external runtime snapshot: %v", err)
	}
	hash, err := runtimeSnapshotHash(snapshot)
	if err != nil {
		t.Fatalf("hash external runtime snapshot: %v", err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID:                  attemptID,
		TurnID:              turnID,
		AttemptIndex:        1,
		RuntimeSnapshot:     encoded,
		RuntimeSnapshotHash: hash,
		StartedAt:           now,
	}).Error; err != nil {
		t.Fatalf("seed external runtime attempt: %v", err)
	}
}

func externalTurnRequest(
	conversationID string,
	attemptID string,
	input string,
) ExternalRuntimeTurnRequest {
	return ExternalRuntimeTurnRequest{
		ActorPTID:        "ptid:person:owner",
		AgentID:          "agent-1",
		ConversationID:   conversationID,
		AttemptID:        attemptID,
		RuntimeProfileID: modernChatAgentProfileID,
		SystemPrompt:     "System",
		UserInput:        input,
	}
}

func externalHomeRef(t *testing.T, conversationID string, epoch uint64) string {
	t.Helper()
	ref, err := externalruntime.RuntimeHomeRef(
		"ptid:person:owner",
		conversationID,
		epoch,
	)
	if err != nil {
		t.Fatalf("derive external runtime home: %v", err)
	}
	return ref
}

func loadExternalRuntimeBinding(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
) *model.ConversationRuntimeBinding {
	t.Helper()
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", conversationID).Error; err != nil {
		t.Fatalf("load external runtime conversation: %v", err)
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(
		conversation.RuntimeBinding,
	)
	if err != nil {
		t.Fatalf("decode external runtime binding: %v", err)
	}
	return binding
}

func stringPtr(value string) *string {
	return &value
}
