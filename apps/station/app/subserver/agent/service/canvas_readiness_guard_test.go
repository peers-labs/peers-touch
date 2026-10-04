package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func assertCanvasReadinessError(t *testing.T, err error) {
	t.Helper()
	var biz *errcode.BizError
	if !errors.As(err, &biz) {
		t.Fatalf("expected BizError, got %T: %v", err, err)
	}
	if biz.Code != errcode.AgentCanvasSingleAgentNotReady {
		t.Fatalf("unexpected error code: %s", biz.Code)
	}
	payload := biz.Payload
	if payload == nil ||
		payload.GetErrorType() != string(errcode.AgentCanvasSingleAgentNotReady) ||
		payload.GetLocaleKey() != errcode.AgentCanvasSingleAgentNotReadyLocaleKey ||
		payload.GetRetryable() ||
		!payload.GetTerminal() ||
		payload.GetDetails()["required_gate"] != errcode.AgentCanvasSingleAgentNotReadyRequiredGate {
		t.Fatalf("unexpected readiness blocker: %+v", payload)
	}
}

func TestCanvasReadinessGuardContract(t *testing.T) {
	assertCanvasReadinessError(t, enforce_canvas_single_agent_readiness())
}

func TestCanvasReadinessGuardRejectsBeforeDependencyOrStorageAccess(t *testing.T) {
	ctx := context.Background()
	orchestration := &OrchestrationService{}
	scheduler := &SchedulerService{}

	cases := []struct {
		name   string
		invoke func() error
	}{
		{
			name: "create collaboration task",
			invoke: func() error {
				_, _, err := orchestration.CreateCollaborationTask(ctx, "", nil)
				return err
			},
		},
		{
			name: "resume collaboration task",
			invoke: func() error {
				_, _, err := orchestration.ResumeCollaborationTask(ctx, "", "", "")
				return err
			},
		},
		{
			name: "submit collaboration node result",
			invoke: func() error {
				_, _, err := orchestration.SubmitCollaborationNodeResult(ctx, "", nil)
				return err
			},
		},
		{
			name: "claim desktop executor task",
			invoke: func() error {
				_, err := orchestration.ClaimDesktopExecutorTask(ctx, "", nil)
				return err
			},
		},
		{
			name: "heartbeat executor lease",
			invoke: func() error {
				_, err := orchestration.HeartbeatExecutorLease(ctx, "", nil)
				return err
			},
		},
		{
			name: "resolve collaboration interrupt",
			invoke: func() error {
				_, _, err := orchestration.ResolveCollaborationInterrupt(
					ctx, "", "", "", "", nil,
				)
				return err
			},
		},
		{
			name: "run supervisor tick",
			invoke: func() error {
				_, _, _, err := orchestration.RunCollaborationSupervisorTick(ctx, "", "")
				return err
			},
		},
		{
			name: "run supervisor sweep",
			invoke: func() error {
				_, err := orchestration.RunCollaborationSupervisorSweep(ctx, "", 0)
				return err
			},
		},
		{
			name: "run supervisor transaction",
			invoke: func() error {
				_, _, _, err := runCollaborationSupervisorTickTx(
					ctx, nil, nil, "", "", time.Time{},
				)
				return err
			},
		},
		{
			name: "execute pending direct run",
			invoke: func() error {
				return orchestration.executePendingDirectRun(ctx, "", "", "")
			},
		},
		{
			name: "resolve Atelier decision",
			invoke: func() error {
				atelier := &AtelierProjectionService{}
				_, err := atelier.ResolveDecision(ctx, "", nil)
				return err
			},
		},
		{
			name: "confirm Atelier rerun",
			invoke: func() error {
				atelier := &AtelierProjectionService{}
				_, err := atelier.ConfirmRerun(ctx, "", nil)
				return err
			},
		},
		{
			name: "scheduler supervisor sweep",
			invoke: func() error {
				return scheduler.executeCollaborationSupervisorSweep(ctx, "")
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertCanvasReadinessError(t, tc.invoke())
		})
	}

	// These void paths must return before touching DB, goroutines, or providers.
	orchestration.StartTaskRecovery(ctx)
	orchestration.recoverRunningTasks(ctx)
	orchestration.startTaskExecution("", persistence.CollaborationTask{}, nil, "")
	orchestration.startDirectRunExecution("", "", "")
}

func TestAtelierProjectCreationUsesCanonicalWriterWithoutCanvasReadiness(
	t *testing.T,
) {
	atelier := NewAtelierProjectionService(&OrchestrationService{})
	_, err := atelier.CreateProjectFromGoal(context.Background(), "", nil)
	var biz *errcode.BizError
	if !errors.As(err, &biz) {
		t.Fatalf("expected BizError, got %T: %v", err, err)
	}
	if biz.Code != errcode.AgentUnauthorized {
		t.Fatalf("unexpected error code: %s", biz.Code)
	}
}

func TestCanvasReadinessGuardProducesZeroDatabaseAndProviderMutations(t *testing.T) {
	ctx := context.Background()
	db := openResumeCollaborationTaskDB(t, "canvas_readiness_zero_mutation")
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open sqlite handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	injectOrchestrationServiceTestStore(t, db)

	var changesBefore int64
	if err := db.Raw("SELECT total_changes()").Scan(&changesBefore).Error; err != nil {
		t.Fatalf("read changes before rejection: %v", err)
	}
	provider := &fakeDirectRunProviderExecutor{}
	orchestration := &OrchestrationService{directRunProvider: provider}

	_, _, createErr := orchestration.CreateCollaborationTask(
		ctx,
		"ptid:person:fixture",
		&model.CreateCollaborationTaskRequest{},
	)
	assertCanvasReadinessError(t, createErr)
	assertCanvasReadinessError(
		t,
		orchestration.executePendingDirectRun(
			ctx,
			"ptid:person:fixture",
			"task-fixture",
			"test",
		),
	)

	var changesAfter int64
	if err := db.Raw("SELECT total_changes()").Scan(&changesAfter).Error; err != nil {
		t.Fatalf("read changes after rejection: %v", err)
	}
	if changesAfter != changesBefore {
		t.Fatalf("database changed during rejection: before=%d after=%d", changesBefore, changesAfter)
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls=%d, want 0", provider.calls)
	}
}

func TestCanvasReadinessGuardDoesNotBlockCleanupContracts(t *testing.T) {
	// Compile-time coverage: the guard is intentionally absent from cleanup APIs.
	var _ = (*OrchestrationService).CancelCollaborationTask
	var _ = (*OrchestrationService).ReleaseExecutorLease
	var _ = (*AtelierProjectionService).PurgeTask
	var _ = (*OrchestrationService).GetCollaborationTask
	var _ = (*OrchestrationService).ListCollaborationTasks
	var _ = (*OrchestrationService).ListTaskEvents
	var _ *model.CollaborationTask
}
