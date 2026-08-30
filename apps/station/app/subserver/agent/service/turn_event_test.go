package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestEmitTurnEventAppliesTurnContext(t *testing.T) {
	var captured TurnEvent
	config := &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_1",
		EventSink: func(ctx context.Context, event TurnEvent) {
			captured = event
		},
	}

	var svc TurnService
	svc.emitTurnEvent(context.Background(), config, "turn_1", TurnEvent{
		Type:  "tool_call",
		Stage: "dispatch",
	})

	if captured.Type != "tool_call" {
		t.Fatalf("expected tool_call event, got %q", captured.Type)
	}
	if captured.TurnID != "turn_1" {
		t.Fatalf("expected turn id to be applied, got %q", captured.TurnID)
	}
	if captured.AgentID != "agent_1" {
		t.Fatalf("expected agent id to be applied, got %q", captured.AgentID)
	}
	if captured.ConversationID != "conv_1" {
		t.Fatalf("expected conversation id to be applied, got %q", captured.ConversationID)
	}
}

func TestEmitTurnEventPersistsWithoutLiveSink(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_event_without_sink")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_persisted",
		AgentID:   "agent_1",
		Ptid:      "actor_1",
		Title:     "Persisted events",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_persisted",
		ConversationID: "conv_persisted",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}

	svc := TurnService{convService: NewConversationService()}
	svc.emitTurnEvent(context.Background(), &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_persisted",
	}, "turn_persisted", TurnEvent{
		Type:  "progress",
		Stage: "waiting_local_tool",
	})

	var event persistence.TurnEvent
	if err := db.First(&event, "turn_id = ?", "turn_persisted").Error; err != nil {
		t.Fatalf("load persisted turn event: %v", err)
	}
	if event.EventType != "progress" {
		t.Fatalf("expected progress event, got %q", event.EventType)
	}
}

func TestTurnServiceSaveTurnTraceUpsertsByTurn(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_trace_upsert")
	if err := db.AutoMigrate(&persistence.TurnTrace{}); err != nil {
		t.Fatalf("migrate turn trace: %v", err)
	}
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_trace",
		AgentID:   "agent_1",
		Ptid:      "actor_1",
		Title:     "Trace",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_trace",
		ConversationID: "conv_trace",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}

	svc := TurnService{}
	trace := &domain.TurnTrace{
		TraceID: "trace_1",
		TurnID:  "turn_trace",
		ProviderCalls: []domain.ProviderCallRecord{{
			Provider: "provider_1",
			Model:    "model_1",
		}},
	}
	if err := svc.saveTurnTrace(context.Background(), trace); err != nil {
		t.Fatalf("save paused trace: %v", err)
	}
	trace.ProviderCalls = append(trace.ProviderCalls, domain.ProviderCallRecord{
		Provider: "provider_1",
		Model:    "model_2",
	})
	if err := svc.saveTurnTrace(context.Background(), trace); err != nil {
		t.Fatalf("update resumed trace: %v", err)
	}

	var count int64
	if err := db.Model(&persistence.TurnTrace{}).Where("turn_id = ?", trace.TurnID).Count(&count).Error; err != nil {
		t.Fatalf("count turn traces: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one trace row after resume, got %d", count)
	}
	loaded, err := svc.loadTurnTraceForResume(context.Background(), trace.TurnID)
	if err != nil {
		t.Fatalf("load resumed trace: %v", err)
	}
	if len(loaded.ProviderCalls) != 2 || loaded.ProviderCalls[1].Model != "model_2" {
		t.Fatalf("expected resumed trace update, got %+v", loaded.ProviderCalls)
	}
}

func TestToolDecisionTurnEventCarriesManualApprovalProjection(t *testing.T) {
	event := toolDecisionTurnEvent(ProposalDecision{
		ToolCallID:       "tool-call-1",
		ToolName:         "local_shell_safe",
		Arguments:        `{"command_ref":"command-1"}`,
		ApprovalID:       "approval-1",
		DecisionRevision: 0,
		Status:           persistence.ToolCallStatusWaitingApproval,
	}, 2)

	if event.Type != "tool_approval_required" ||
		event.ToolCallID != "tool-call-1" ||
		event.ToolName != "local_shell_safe" ||
		event.Arguments != `{"command_ref":"command-1"}` ||
		event.ApprovalID != "approval-1" ||
		event.DecisionRevision != 0 ||
		event.Iteration != 2 {
		t.Fatalf("unexpected approval projection: %+v", event)
	}
}

func TestCancelTurnCancelsRegisteredExecution(t *testing.T) {
	svc := TurnService{}
	lifecycleCtx, stopLifecycle := context.WithCancel(context.Background())
	svc.SetExecutionLifecycle(lifecycleCtx)
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	ctx, release := svc.RegisterTurn(transportCtx, "turn_1")
	defer release()

	cancelTransport()
	select {
	case <-ctx.Done():
		t.Fatal("transport cancellation must not cancel the semantic turn")
	case <-time.After(25 * time.Millisecond):
	}

	if !svc.cancelActiveTurn("turn_1") {
		t.Fatal("expected active turn cancellation to be accepted")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("registered turn context was not cancelled")
	}
	if !errors.Is(context.Cause(ctx), errExplicitUserCancellation) {
		t.Fatalf("explicit cancellation cause = %v", context.Cause(ctx))
	}
	if svc.cancelActiveTurn("missing") {
		t.Fatal("missing turn must not report cancellation success")
	}

	lifecycleTurn, releaseLifecycleTurn := svc.RegisterTurn(context.Background(), "turn_2")
	defer releaseLifecycleTurn()
	stopLifecycle()
	select {
	case <-lifecycleTurn.Done():
	case <-time.After(time.Second):
		t.Fatal("Station lifecycle cancellation did not stop detached turn")
	}
	if !errors.Is(context.Cause(lifecycleTurn), context.Canceled) ||
		errors.Is(context.Cause(lifecycleTurn), errExplicitUserCancellation) {
		t.Fatalf("lifecycle cancellation cause = %v", context.Cause(lifecycleTurn))
	}
}

func TestRegisterTurnFencesSupersededRelease(t *testing.T) {
	svc := TurnService{}
	svc.SetExecutionLifecycle(context.Background())

	first, releaseFirst := svc.RegisterTurn(context.Background(), "turn-reused")
	second, releaseSecond := svc.RegisterTurn(context.Background(), "turn-reused")
	defer releaseSecond()

	select {
	case <-first.Done():
	case <-time.After(time.Second):
		t.Fatal("superseded turn registration remained active")
	}
	if !errors.Is(context.Cause(first), errTurnExecutionSuperseded) {
		t.Fatalf("superseded registration cause = %v", context.Cause(first))
	}

	releaseFirst()
	if !svc.cancelActiveTurn("turn-reused") {
		t.Fatal("superseded release deleted the current registration")
	}
	select {
	case <-second.Done():
	case <-time.After(time.Second):
		t.Fatal("current registration did not receive explicit cancellation")
	}
	if !errors.Is(context.Cause(second), errExplicitUserCancellation) {
		t.Fatalf("current registration cause = %v", context.Cause(second))
	}
}

func TestSupersededExecutionCannotRaceNewOwnerTerminalCommit(t *testing.T) {
	db := openConversationAuthorityDB(t, "superseded_execution_terminal_race")
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_generation_race", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Generation race", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_generation_race", ConversationID: "conv_generation_race",
		AgentID: "agent_1", Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_generation_race", TurnID: "turn_generation_race", AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	svc := TurnService{convService: NewConversationService()}
	firstCtx, releaseFirst := svc.RegisterTurn(context.Background(), "turn_generation_race")
	defer releaseFirst()
	secondCtx, releaseSecond := svc.RegisterTurn(context.Background(), "turn_generation_race")
	defer releaseSecond()

	config := &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_generation_race",
		AttemptID:      "attempt_generation_race",
		Model:          "model-1",
	}
	start := make(chan struct{})
	oldResult := make(chan error, 1)
	newResult := make(chan error, 1)
	go func() {
		<-start
		oldResult <- svc.settleAdmittedTurnAfterError(
			firstCtx,
			config,
			"turn_generation_race",
			"old execution failed",
			errors.New("old provider failure"),
		)
	}()
	go func() {
		<-start
		newResult <- svc.completeTurn(
			secondCtx,
			config,
			"turn_generation_race",
			"new owner answer",
			0,
		)
	}()
	close(start)

	if err := <-oldResult; !errors.Is(err, errTurnExecutionSuperseded) {
		t.Fatalf("old execution result = %v, want superseded", err)
	}
	if err := <-newResult; err != nil {
		t.Fatalf("new owner completion failed: %v", err)
	}

	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", "turn_generation_race").Error; err != nil {
		t.Fatal(err)
	}
	if turn.Status != string(domain.TurnStatusCompleted) ||
		stringValue(turn.FinalResponse) != "new owner answer" {
		t.Fatalf("superseded execution overwrote new owner: %+v", turn)
	}
	var failedEvents int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND event_type = ?", turn.ID, "error").
		Count(&failedEvents).Error; err != nil {
		t.Fatal(err)
	}
	if failedEvents != 0 {
		t.Fatalf("superseded execution persisted %d failure events", failedEvents)
	}
}

func TestExecutionLifecycleShutdownWaitsForActiveTurnAndWorker(t *testing.T) {
	svc := TurnService{}
	svc.SetExecutionLifecycle(context.Background())

	_, releaseTurn := svc.RegisterTurn(context.Background(), "turn-active-at-shutdown")
	workerRelease := make(chan struct{})
	workerExited := make(chan struct{})
	if !svc.RunExecutionWorker(func(context.Context) {
		defer close(workerExited)
		<-workerRelease
	}) {
		t.Fatal("execution worker was rejected before shutdown")
	}

	timeoutCtx, cancelTimeout := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelTimeout()
	if err := svc.StopExecutionLifecycle(timeoutCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("shutdown barrier error = %v, want deadline exceeded while work is active", err)
	}

	releaseTurn()
	close(workerRelease)
	select {
	case <-workerExited:
	case <-time.After(time.Second):
		t.Fatal("execution worker did not exit")
	}
	if err := svc.StopExecutionLifecycle(context.Background()); err != nil {
		t.Fatalf("shutdown barrier did not drain: %v", err)
	}
}

func TestLifecycleCancellationInterruptsDirectTurnForRetry(t *testing.T) {
	db := openConversationAuthorityDB(t, "lifecycle_interrupts_direct_turn")
	if err := db.AutoMigrate(&persistence.TurnAttempt{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_lifecycle", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Lifecycle", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_lifecycle", ConversationID: "conv_lifecycle", AgentID: "agent_1",
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_lifecycle", TurnID: "turn_lifecycle", AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	lifecycleCtx, stopLifecycle := context.WithCancel(context.Background())
	stopLifecycle()
	svc := TurnService{convService: NewConversationService()}
	err := svc.interruptTurnAfterError(
		lifecycleCtx,
		&TurnConfig{AgentID: "agent_1", ConversationID: "conv_lifecycle"},
		"turn_lifecycle",
		"station_lifecycle_interrupted",
		context.Canceled,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupt result = %v, want context cancellation", err)
	}

	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", "turn_lifecycle").Error; err != nil {
		t.Fatal(err)
	}
	if turn.Status != string(domain.TurnStatusInterrupted) ||
		turn.TerminalReason != "station_lifecycle_interrupted" {
		t.Fatalf("lifecycle cancellation persisted wrong terminal state: %+v", turn)
	}
	if turn.TerminalReason == "cancelled_by_user" {
		t.Fatal("Station lifecycle cancellation was persisted as user cancellation")
	}
}

func TestTerminalPersistenceErrorRemainsClassifiableThroughWrapping(t *testing.T) {
	err := errors.Join(
		errors.New("provider failed"),
		turnTerminalPersistenceError("test terminal transaction", errors.New("database unavailable")),
	)
	if !IsTurnEventPersistenceError(err) {
		t.Fatalf("terminal persistence ownership was lost through wrapping: %v", err)
	}
}

func TestEmitTurnEventFailsClosedWhenPersistenceFails(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_event_persistence_failure")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_failure",
		AgentID:   "agent_1",
		Ptid:      "actor_1",
		Title:     "Persistence failure",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_failure",
		ConversationID: "conv_failure",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}
	if err := db.Migrator().DropTable(&persistence.TurnEvent{}); err != nil {
		t.Fatalf("drop turn event table: %v", err)
	}

	deliveries := 0
	svc := TurnService{convService: NewConversationService()}
	err := svc.emitTurnEvent(context.Background(), &TurnConfig{
		AgentID:        "agent_1",
		ConversationID: "conv_failure",
		EventSink: func(context.Context, TurnEvent) {
			deliveries++
		},
	}, "turn_failure", TurnEvent{Type: "text", Text: "unreplayable"})
	if err == nil {
		t.Fatal("turn event persistence failure must be returned")
	}
	if deliveries != 0 {
		t.Fatalf("persistence failure emitted %d unreplayable live frames", deliveries)
	}
}

func TestCompleteTurnRollsBackAllTerminalStateWhenEventPersistenceFails(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_terminal_atomicity")
	if err := db.AutoMigrate(&persistence.TurnAttempt{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_atomic", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Atomic", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_atomic", ConversationID: "conv_atomic", AgentID: "agent_1",
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_atomic", TurnID: "turn_atomic", AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&persistence.TurnEvent{}); err != nil {
		t.Fatal(err)
	}

	svc := TurnService{convService: NewConversationService()}
	err := svc.completeTurn(context.Background(), &TurnConfig{
		ConversationID: "conv_atomic",
		AgentID:        "agent_1",
		Model:          "model-1",
	}, "turn_atomic", "answer", 0)
	if err == nil {
		t.Fatal("terminal event failure must abort completion")
	}
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", "turn_atomic").Error; err != nil {
		t.Fatal(err)
	}
	if turn.Status != string(domain.TurnStatusRunning) || turn.EndedAt != nil {
		t.Fatalf("turn escaped rolled-back terminal transaction: %+v", turn)
	}
	var assistantCount int64
	if err := db.Model(&persistence.AgentMessage{}).
		Where("turn_id = ? AND role = ?", "turn_atomic", string(domain.MessageRoleAssistant)).
		Count(&assistantCount).Error; err != nil {
		t.Fatal(err)
	}
	if assistantCount != 0 {
		t.Fatalf("assistant message escaped rolled-back terminal transaction: %d", assistantCount)
	}
}

func TestCompleteTurnDeliversCommittedTerminalSequence(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_terminal_live_sequence")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_terminal_live", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Terminal live", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_terminal_live", ConversationID: "conv_terminal_live", AgentID: "agent_1",
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_terminal_live", TurnID: "turn_terminal_live", AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	var delivered TurnEvent
	svc := TurnService{convService: NewConversationService()}
	config := &TurnConfig{
		ConversationID: "conv_terminal_live",
		AgentID:        "agent_1",
		AttemptID:      "attempt_terminal_live",
		Model:          "model-1",
		EventSink: func(_ context.Context, event TurnEvent) {
			delivered = event
		},
	}
	if err := svc.completeTurn(context.Background(), config, "turn_terminal_live", "answer", 2); err != nil {
		t.Fatalf("complete turn: %v", err)
	}

	var persisted persistence.TurnEvent
	if err := db.Where("turn_id = ? AND event_type = ?", "turn_terminal_live", "done").
		First(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if delivered.Type != "done" ||
		delivered.Seq != persisted.EventSeq ||
		delivered.AttemptID != persisted.AttemptID ||
		delivered.Seq == 0 {
		t.Fatalf("live terminal does not match committed sequence: delivered=%+v persisted=%+v", delivered, persisted)
	}
}

func TestFailedTurnDeliversCommittedTerminalSequence(t *testing.T) {
	db := openConversationAuthorityDB(t, "turn_failed_live_sequence")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_failed_live", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Failed live", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_failed_live", ConversationID: "conv_failed_live", AgentID: "agent_1",
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_failed_live", TurnID: "turn_failed_live", AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	var delivered TurnEvent
	cause := errors.New("provider failed")
	svc := TurnService{convService: NewConversationService()}
	config := &TurnConfig{
		ConversationID: "conv_failed_live",
		AgentID:        "agent_1",
		AttemptID:      "attempt_failed_live",
		EventSink: func(_ context.Context, event TurnEvent) {
			delivered = event
		},
	}
	if err := svc.failTurnAfterError(
		context.Background(),
		config,
		"turn_failed_live",
		"provider failed",
		cause,
	); !errors.Is(err, cause) {
		t.Fatalf("failure cause changed: %v", err)
	}

	var persisted persistence.TurnEvent
	if err := db.Where("turn_id = ? AND event_type = ?", "turn_failed_live", "error").
		First(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if delivered.Type != "error" ||
		delivered.Seq != persisted.EventSeq ||
		delivered.AttemptID != persisted.AttemptID ||
		delivered.Seq == 0 {
		t.Fatalf("live failure does not match committed sequence: delivered=%+v persisted=%+v", delivered, persisted)
	}
}

func TestCreateOrReopenTurnRecordRequiresAtomicRetryAdmission(t *testing.T) {
	db := openConversationAuthorityDB(t, "reopen_interrupted_turn")
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_interrupted",
		AgentID:   "agent_1",
		Ptid:      "ptid:person:owner",
		Title:     "Interrupted retry",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_interrupted",
		ConversationID: "conv_interrupted",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed admitted retry turn: %v", err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID:           "attempt_interrupted_retry",
		TurnID:       "turn_interrupted",
		AttemptIndex: 2,
		Status:       string(domain.TurnStatusRunning),
		StartedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed admitted retry attempt: %v", err)
	}

	svc := TurnService{}
	record, err := svc.createOrReopenTurnRecord(context.Background(), &TurnConfig{
		ExistingTurnID: "turn_interrupted",
		ConversationID: "conv_interrupted",
		AttemptID:      "attempt_interrupted_retry",
	}, "question")
	if err != nil {
		t.Fatalf("accept admitted retry turn: %v", err)
	}
	if record.Status != string(domain.TurnStatusRunning) ||
		record.EndedAt != nil ||
		record.TerminalReason != "" {
		t.Fatalf("atomic retry admission was not preserved: %+v", record)
	}
}

func TestExistingRetryAdmissionSettlesEarlyExecutionFailure(t *testing.T) {
	db := openConversationAuthorityDB(t, "retry_early_execution_failure")
	if err := db.AutoMigrate(
		&persistence.ExecutionStep{},
		&persistence.ExecutorLease{},
		&persistence.ToolBatch{},
		&persistence.ToolCall{},
	); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_retry_early_failure", AgentID: "agent_1", Ptid: "ptid:person:owner",
		Title: "Retry early failure", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_retry_early_failure", ConversationID: "conv_retry_early_failure",
		AgentID: "agent_1", Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_retry_early_failure", TurnID: "turn_retry_early_failure",
		AttemptIndex: 2, Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	svc := TurnService{convService: NewConversationService()}
	_, err := svc.ExecuteTurn(context.Background(), &TurnConfig{
		ExistingTurnID: "turn_retry_early_failure",
		AttemptID:      "attempt_retry_early_failure",
		AgentID:        "agent_1",
		ActorID:        "ptid:person:owner",
		ConversationID: "conv_retry_early_failure",
		ThinkingMode:   domain.ThinkingModeDisabled,
	}, "question")
	if err == nil {
		t.Fatal("missing runtime admission authority must fail execution")
	}

	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", "turn_retry_early_failure").Error; err != nil {
		t.Fatal(err)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt_retry_early_failure").Error; err != nil {
		t.Fatal(err)
	}
	if turn.Status != string(domain.TurnStatusFailed) ||
		attempt.Status != string(domain.TurnStatusFailed) ||
		turn.EndedAt == nil ||
		attempt.EndedAt == nil {
		t.Fatalf("early retry failure remained active: turn=%+v attempt=%+v", turn, attempt)
	}
	var terminalEvents int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND attempt_id = ? AND event_type = ?", turn.ID, attempt.ID, "error").
		Count(&terminalEvents).Error; err != nil {
		t.Fatal(err)
	}
	if terminalEvents != 1 {
		t.Fatalf("early retry failure terminal events = %d, want 1", terminalEvents)
	}
}

// This regression matrix proves post-admission preparation failures cannot
// bypass TurnService's durable lifecycle settlement or typed terminal causes.
func TestSettleAdmittedTurnAfterPostAdmissionFailure(t *testing.T) {
	eventPersistenceCause := errors.Join(
		errTurnEventPersistence,
		errors.New("persist progress event"),
	)
	schemaCause := errcode.New(
		errcode.AgentInvalidSourceState,
		http.StatusConflict,
		"build authorized Tool schema context",
		errors.New("schema mismatch"),
	)
	tests := []struct {
		name           string
		context        func() context.Context
		cause          error
		reason         string
		wantStatus     domain.TurnStatus
		wantReason     string
		wantEventType  string
		assertReturned func(*testing.T, error)
	}{
		{
			name:          "turn_event_persistence",
			context:       context.Background,
			cause:         eventPersistenceCause,
			reason:        "failed to persist provider start event",
			wantStatus:    domain.TurnStatusFailed,
			wantReason:    "failed to persist provider start event",
			wantEventType: "error",
			assertReturned: func(t *testing.T, err error) {
				t.Helper()
				if !errors.Is(err, eventPersistenceCause) ||
					!IsTurnEventPersistenceError(err) {
					t.Fatalf("event persistence cause was weakened: %v", err)
				}
			},
		},
		{
			name:          "schema_context",
			context:       context.Background,
			cause:         schemaCause,
			reason:        "failed to build authorized Tool schema context",
			wantStatus:    domain.TurnStatusFailed,
			wantReason:    "failed to build authorized Tool schema context",
			wantEventType: "error",
			assertReturned: func(t *testing.T, err error) {
				t.Helper()
				var bizErr *errcode.BizError
				if !errors.As(err, &bizErr) || bizErr.Code != errcode.AgentInvalidSourceState {
					t.Fatalf("schema-context error lost its typed code: %v", err)
				}
			},
		},
		{
			name: "explicit_cancellation_wins",
			context: func() context.Context {
				ctx, cancel := context.WithCancelCause(context.Background())
				cancel(errExplicitUserCancellation)
				return ctx
			},
			cause:         eventPersistenceCause,
			reason:        "failed to persist provider start event",
			wantStatus:    domain.TurnStatusCancelled,
			wantReason:    "cancelled_by_user",
			wantEventType: "cancelled",
			assertReturned: func(t *testing.T, err error) {
				t.Helper()
				if !errors.Is(err, errExplicitUserCancellation) {
					t.Fatalf("explicit cancellation cause was lost: %v", err)
				}
			},
		},
		{
			name: "station_interruption_wins",
			context: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
			cause:         eventPersistenceCause,
			reason:        "failed to persist provider start event",
			wantStatus:    domain.TurnStatusInterrupted,
			wantReason:    "station_lifecycle_interrupted",
			wantEventType: "error",
			assertReturned: func(t *testing.T, err error) {
				t.Helper()
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("Station interruption cause was lost: %v", err)
				}
			},
		},
		{
			name: "runtime_budget_wins",
			context: func() context.Context {
				ctx, cancel := context.WithDeadlineCause(
					context.Background(),
					time.Now().Add(-time.Second),
					wallTimeBudgetExhausted(25),
				)
				t.Cleanup(cancel)
				return ctx
			},
			cause:         eventPersistenceCause,
			reason:        "failed to persist provider start event",
			wantStatus:    domain.TurnStatusFailed,
			wantReason:    wallTimeExhaustedReason,
			wantEventType: "error",
			assertReturned: func(t *testing.T, err error) {
				t.Helper()
				var budgetErr *errcode.BizError
				if !errors.As(err, &budgetErr) ||
					budgetErr.Code != errcode.AgentToolBudgetExhausted {
					t.Fatalf("runtime budget error lost its typed code: %v", err)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := openConversationAuthorityDB(t, "post_admission_"+test.name)
			if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
				t.Fatalf("migrate Agent models: %v", err)
			}
			now := time.Now().UTC()
			turnID := "turn_" + test.name
			attemptID := "attempt_" + test.name
			taskID := "task_" + test.name
			stepID := "step_" + test.name
			pendingContent := ""
			records := []struct {
				name  string
				value interface{}
			}{
				{name: "conversation", value: &persistence.Conversation{
					ID: "conv_" + test.name, AgentID: "agent_1", Ptid: "actor_1",
					Title: "Post-admission settlement", Status: "active",
					CreatedAt: now, UpdatedAt: now,
				}},
				{name: "turn", value: &persistence.AgentTurn{
					ID: turnID, ConversationID: "conv_" + test.name, AgentID: "agent_1",
					Status: string(domain.TurnStatusRunning), StartedAt: now,
				}},
				{name: "attempt", value: &persistence.TurnAttempt{
					ID: attemptID, TurnID: turnID, AttemptIndex: 1,
					Status: string(domain.TurnStatusRunning), StartedAt: now,
				}},
				{name: "assistant message", value: &persistence.AgentMessage{
					ID: "message_" + test.name, ConversationID: "conv_" + test.name,
					TurnID: &turnID, Role: string(domain.MessageRoleAssistant),
					Status: "pending", Content: &pendingContent, Seq: 1,
					CreatedAt: now, UpdatedAt: now,
				}},
				{name: "task", value: &persistence.TaskRun{
					TaskID: taskID, Title: "Post-admission settlement",
					Surface:      int32(model.TaskSurface_TASK_SURFACE_CHAT),
					Status:       int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
					OwnerActorID: "actor_1", ConversationID: "conv_" + test.name,
					CreatedAt: now, StartedAt: now, UpdatedAt: now,
				}},
				{name: "step", value: &persistence.ExecutionStep{
					StepID: stepID, TaskID: taskID, AgentID: "agent_1", TurnID: turnID,
					Status:  int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
					Attempt: 1, StartedAt: now,
				}},
				{name: "lease", value: &persistence.ExecutorLease{
					LeaseID: "lease_" + test.name, TaskID: taskID, StepID: stepID,
					ExecutorID: "station", ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED),
					Status: chatLeaseStatusActive, AcquiredAt: now,
					HeartbeatAt: now, ExpiresAt: now.Add(time.Minute),
				}},
			}
			for _, record := range records {
				if err := db.Create(record.value).Error; err != nil {
					t.Fatalf("seed %s: %v", record.name, err)
				}
			}

			config := &TurnConfig{
				AgentID: "agent_1", ConversationID: "conv_" + test.name,
				TaskID: taskID, StepID: stepID, AttemptID: attemptID,
			}
			err := (&TurnService{convService: NewConversationService()}).
				settleAdmittedTurnAfterError(
					test.context(),
					config,
					turnID,
					test.reason,
					test.cause,
				)
			test.assertReturned(t, err)

			var turn persistence.AgentTurn
			if err := db.First(&turn, "id = ?", turnID).Error; err != nil {
				t.Fatal(err)
			}
			var attempt persistence.TurnAttempt
			if err := db.First(&attempt, "id = ?", attemptID).Error; err != nil {
				t.Fatal(err)
			}
			var message persistence.AgentMessage
			if err := db.First(&message, "id = ?", "message_"+test.name).Error; err != nil {
				t.Fatal(err)
			}
			if turn.Status != string(test.wantStatus) || turn.TerminalReason != test.wantReason ||
				turn.EndedAt == nil {
				t.Fatalf("turn remained nonterminal: %+v", turn)
			}
			if attempt.Status != string(test.wantStatus) || attempt.EndedAt == nil {
				t.Fatalf("attempt remained nonterminal: %+v", attempt)
			}
			if message.Status != string(test.wantStatus) {
				t.Fatalf("assistant message remained nonterminal: %+v", message)
			}
			var terminalSteps int64
			if err := db.Model(&persistence.ExecutionStep{}).
				Where(
					"step_id = ? AND status = ? AND ended_at IS NOT NULL",
					stepID,
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
				).
				Count(&terminalSteps).Error; err != nil {
				t.Fatal(err)
			}
			if terminalSteps != 1 {
				t.Fatalf("task step remained nonterminal: count=%d", terminalSteps)
			}
			var releasedLeases int64
			if err := db.Model(&persistence.ExecutorLease{}).
				Where("lease_id = ? AND status = ?", "lease_"+test.name, chatLeaseStatusReleased).
				Count(&releasedLeases).Error; err != nil {
				t.Fatal(err)
			}
			if releasedLeases != 1 {
				t.Fatalf("task lease remained active: count=%d", releasedLeases)
			}
			var event persistence.TurnEvent
			if err := db.First(
				&event,
				"turn_id = ? AND attempt_id = ? AND event_type = ?",
				turnID,
				attemptID,
				test.wantEventType,
			).Error; err != nil {
				t.Fatalf("load terminal TurnEvent: %v", err)
			}
		})
	}
}

func TestRequestCancelWaitingToolPersistsCancelledEvent(t *testing.T) {
	db := openConversationAuthorityDB(t, "cancel_waiting_tool_event")
	if err := db.AutoMigrate(
		&persistence.TurnAttempt{},
		&persistence.ToolCall{},
		&persistence.ToolBatch{},
	); err != nil {
		t.Fatalf("migrate cancellation dependencies: %v", err)
	}
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID:        "conv_cancel",
		AgentID:   "agent_1",
		Ptid:      "actor_1",
		Title:     "Cancel waiting tool",
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID:             "turn_cancel",
		ConversationID: "conv_cancel",
		AgentID:        "agent_1",
		Status:         string(domain.TurnStatusWaitingLocalTool),
		StartedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed turn: %v", err)
	}

	svc := TurnService{convService: NewConversationService()}
	status, err := svc.RequestCancelTurn(context.Background(), "actor_1", "turn_cancel")
	if err != nil {
		t.Fatalf("cancel waiting turn: %v", err)
	}
	if status != string(domain.TurnStatusCancelled) {
		t.Fatalf("cancel status = %q, want cancelled", status)
	}

	var event persistence.TurnEvent
	if err := db.First(&event, "turn_id = ? AND event_type = ?", "turn_cancel", "cancelled").Error; err != nil {
		t.Fatalf("load cancelled event: %v", err)
	}
	if event.EventSeq != 1 {
		t.Fatalf("cancelled event sequence = %d, want 1", event.EventSeq)
	}
}

func TestRequestCancelMissingTurnReturnsTypedNotFound(t *testing.T) {
	openConversationAuthorityDB(t, "cancel_missing_turn")
	svc := TurnService{convService: NewConversationService()}

	_, err := svc.RequestCancelTurn(
		context.Background(),
		"actor_1",
		"missing_turn",
	)
	var businessError *errcode.BizError
	if !errors.As(err, &businessError) {
		t.Fatalf("cancel missing turn error = %T %v, want BizError", err, err)
	}
	if businessError.Code != errcode.AgentNotFound ||
		businessError.HTTPStatus != http.StatusNotFound {
		t.Fatalf("cancel missing turn error = %+v, want typed not found", businessError)
	}
}

func TestRequestCancelDoesNotSignalBeforeDurableCommit(t *testing.T) {
	db := openConversationAuthorityDB(t, "cancel_crash_order")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_cancel_crash", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Cancel crash order", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_cancel_crash", ConversationID: "conv_cancel_crash",
		AgentID: "agent_1", Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	svc := TurnService{convService: NewConversationService()}
	executionCtx, release := svc.RegisterTurn(context.Background(), "turn_cancel_crash")
	defer release()
	if err := db.Migrator().DropTable(&persistence.TurnEvent{}); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.RequestCancelTurn(context.Background(), "actor_1", "turn_cancel_crash"); err == nil {
		t.Fatal("cancellation must fail when durable terminal event cannot commit")
	}
	select {
	case <-executionCtx.Done():
		t.Fatal("live execution was signalled before durable cancellation committed")
	default:
	}
	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", "turn_cancel_crash").Error; err != nil {
		t.Fatal(err)
	}
	if turn.Status != string(domain.TurnStatusRunning) {
		t.Fatalf("failed cancellation transaction changed turn status to %q", turn.Status)
	}
}

func TestRequestCancelReturnsDurableTerminalWinner(t *testing.T) {
	db := openConversationAuthorityDB(t, "cancel_terminal_winner")
	now := time.Now()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_cancel_winner", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Cancel terminal winner", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_cancel_winner", ConversationID: "conv_cancel_winner",
		AgentID: "agent_1", Status: string(domain.TurnStatusCompleted), StartedAt: now, EndedAt: &now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	svc := TurnService{convService: NewConversationService()}
	executionCtx, release := svc.RegisterTurn(context.Background(), "turn_cancel_winner")
	defer release()

	status, err := svc.RequestCancelTurn(context.Background(), "actor_1", "turn_cancel_winner")
	if err != nil {
		t.Fatalf("request cancellation: %v", err)
	}
	if status != string(domain.TurnStatusCompleted) {
		t.Fatalf("cancel status = %q, want durable completed winner", status)
	}
	select {
	case <-executionCtx.Done():
		t.Fatalf("completed winner was signalled as cancelled: %v", context.Cause(executionCtx))
	default:
	}
	var cancelledEvents int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND event_type = ?", "turn_cancel_winner", "cancelled").
		Count(&cancelledEvents).Error; err != nil {
		t.Fatal(err)
	}
	if cancelledEvents != 0 {
		t.Fatalf("completed winner produced %d cancellation events", cancelledEvents)
	}
}

func TestRequestCancelAllowsCurrentExecutionToFinalizeUsageAndTrace(t *testing.T) {
	db := openConversationAuthorityDB(t, "cancelled_execution_usage_trace")
	if err := db.AutoMigrate(
		&persistence.ToolCall{},
		&persistence.ToolBatch{},
		&persistence.TurnTrace{},
	); err != nil {
		t.Fatalf("migrate cancellation finalization dependencies: %v", err)
	}
	now := time.Now().UTC()
	if err := db.Create(&persistence.Conversation{
		ID: "conv_cancel_usage", AgentID: "agent_1", Ptid: "actor_1",
		Title: "Cancelled usage", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.AgentTurn{
		ID: "turn_cancel_usage", ConversationID: "conv_cancel_usage",
		AgentID: "agent_1", Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.TurnAttempt{
		ID: "attempt_cancel_usage", TurnID: "turn_cancel_usage", AttemptIndex: 1,
		Status: string(domain.TurnStatusRunning), StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	svc := TurnService{convService: NewConversationService()}
	executionCtx, release := svc.RegisterTurn(context.Background(), "turn_cancel_usage")
	defer release()

	status, err := svc.RequestCancelTurn(context.Background(), "actor_1", "turn_cancel_usage")
	if err != nil {
		t.Fatalf("request cancellation: %v", err)
	}
	if status != string(domain.TurnStatusCancelled) {
		t.Fatalf("cancel status = %q, want cancelled", status)
	}
	if !errors.Is(context.Cause(executionCtx), errExplicitUserCancellation) {
		t.Fatalf("execution cancellation cause = %v", context.Cause(executionCtx))
	}

	trace := &domain.TurnTrace{
		TraceID: "trace_cancel_usage",
		TurnID:  "turn_cancel_usage",
		ProviderCalls: []domain.ProviderCallRecord{{
			Provider:     "provider_1",
			Model:        "model_1",
			InputTokens:  13,
			OutputTokens: 5,
		}},
	}
	terminalCtx := context.WithoutCancel(executionCtx)
	if err := svc.persistAttemptUsage(
		terminalCtx,
		"turn_cancel_usage",
		"attempt_cancel_usage",
		trace,
	); err != nil {
		t.Fatalf("finalize cancelled attempt usage: %v", err)
	}
	if err := svc.saveTurnTrace(terminalCtx, trace); err != nil {
		t.Fatalf("persist cancelled turn trace: %v", err)
	}

	var turn persistence.AgentTurn
	if err := db.First(&turn, "id = ?", "turn_cancel_usage").Error; err != nil {
		t.Fatal(err)
	}
	if turn.Status != string(domain.TurnStatusCancelled) || turn.EndedAt == nil {
		t.Fatalf("turn cancellation was not durable: %+v", turn)
	}
	var attempt persistence.TurnAttempt
	if err := db.First(&attempt, "id = ?", "attempt_cancel_usage").Error; err != nil {
		t.Fatal(err)
	}
	if attempt.Status != string(domain.TurnStatusCancelled) || attempt.EndedAt == nil {
		t.Fatalf("attempt cancellation was not durable: %+v", attempt)
	}
	var usage domain.TurnUsage
	if err := json.Unmarshal(attempt.UsageJSON, &usage); err != nil {
		t.Fatalf("decode cancelled attempt usage: %v", err)
	}
	if usage.InputTokens != 13 || usage.OutputTokens != 5 || usage.ProviderCallCount != 1 {
		t.Fatalf("cancelled attempt usage = %+v", usage)
	}
	var cancelledEvents int64
	if err := db.Model(&persistence.TurnEvent{}).
		Where(
			"turn_id = ? AND attempt_id = ? AND event_type = ?",
			turn.ID,
			attempt.ID,
			"cancelled",
		).
		Count(&cancelledEvents).Error; err != nil {
		t.Fatal(err)
	}
	if cancelledEvents != 1 {
		t.Fatalf("cancelled event count = %d, want 1", cancelledEvents)
	}
	var traces int64
	if err := db.Model(&persistence.TurnTrace{}).
		Where("turn_id = ?", turn.ID).
		Count(&traces).Error; err != nil {
		t.Fatal(err)
	}
	if traces != 1 {
		t.Fatalf("turn trace count = %d, want 1", traces)
	}

	_, releaseReplacement := svc.RegisterTurn(context.Background(), turn.ID)
	defer releaseReplacement()
	staleTrace := &domain.TurnTrace{
		TurnID: turn.ID,
		ProviderCalls: []domain.ProviderCallRecord{{
			InputTokens: 999,
		}},
	}
	if err := svc.persistAttemptUsage(
		terminalCtx,
		turn.ID,
		attempt.ID,
		staleTrace,
	); !errors.Is(err, errTurnExecutionSuperseded) {
		t.Fatalf("superseded usage finalization error = %v, want generation fence", err)
	}
	if err := db.First(&attempt, "id = ?", attempt.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(attempt.UsageJSON, &usage); err != nil {
		t.Fatalf("decode usage after superseded write: %v", err)
	}
	if usage.InputTokens != 13 {
		t.Fatalf("superseded execution overwrote usage: %+v", usage)
	}
}
