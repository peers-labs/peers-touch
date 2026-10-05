package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

type goalCancellationSignalProbe struct {
	db       *gorm.DB
	err      error
	mu       sync.Mutex
	calls    int
	taskIDs  []string
	observed bool
}

func (p *goalCancellationSignalProbe) Cancel(
	_ string,
	taskIDs []string,
) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	p.taskIDs = append(p.taskIDs, taskIDs...)

	var goal persistence.AgentGoal
	var task persistence.TaskRun
	var step persistence.ExecutionStep
	var node persistence.AgentGoalNode
	var run persistence.DirectRun
	var lease persistence.GoalCoordinatorLease
	p.observed =
		p.db.First(&goal, "goal_id = ?", "goal-cancel").Error == nil &&
			p.db.First(&task, "task_id = ?", "task-cancel").Error == nil &&
			p.db.First(&step, "step_id = ?", "step-cancel").Error == nil &&
			p.db.First(
				&node,
				"goal_id = ? AND node_id = ?",
				"goal-cancel",
				"node-cancel",
			).Error == nil &&
			p.db.First(&run, "task_id = ?", "task-cancel").Error == nil &&
			p.db.First(&lease, "goal_id = ?", "goal-cancel").Error == nil &&
			goal.Status == int32(
				model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED,
			) &&
			goal.Revision == 5 &&
			task.Status == int32(
				model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED,
			) &&
			step.Status == int32(
				model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED,
			) &&
			node.Status == int32(
				model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED,
			) &&
			run.State == "cancelled" &&
			lease.Status == goalCoordinatorLeaseCancelled &&
			lease.Generation == 2 &&
			lease.GoalRevision == 5
	return p.err
}

func (p *goalCancellationSignalProbe) snapshot() (
	int,
	[]string,
	bool,
) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls, append([]string(nil), p.taskIDs...), p.observed
}

func TestRunningGoalCancellationPersistsBeforeExecutorSignal(t *testing.T) {
	db := openGoalDirectModelTestDB(t, "goal_active_cancel_durable_first")
	if err := db.AutoMigrate(&persistence.GoalCoordinatorLease{}); err != nil {
		t.Fatalf("migrate Goal coordinator lease: %v", err)
	}
	now := time.Date(2026, 10, 5, 13, 0, 0, 0, time.UTC)
	seedRunningGoalCancellationGraph(t, db, now)
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID: "artifact-before-cancel",
		TaskID:     "task-cancel",
		StepID:     "step-cancel",
		Kind:       "direct_run.partial",
		Name:       "Committed before cancellation",
		URI:        "station://task/task-cancel/artifact/artifact-before-cancel",
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed pre-cancellation artifact: %v", err)
	}

	signalFailure := errors.New("executor signal unavailable")
	signal := &goalCancellationSignalProbe{db: db, err: signalFailure}
	goals := NewGoalService(db)
	goals.now = func() time.Time { return now.Add(time.Minute) }
	cancellation := NewGoalCancellationService(goals, signal)

	cancelled, err := cancellation.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           "goal-cancel",
			ExpectedRevision: 4,
			IdempotencyKey:   "goal-active-cancel",
		},
	)
	if err != nil {
		t.Fatalf("cancel running Goal: %v", err)
	}
	if cancelled.GetStatus() !=
		model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED ||
		cancelled.GetRevision() != 5 {
		t.Fatalf("cancelled Goal = %+v", cancelled)
	}
	calls, taskIDs, observed := signal.snapshot()
	if calls != 1 || len(taskIDs) != 1 || taskIDs[0] != "task-cancel" {
		t.Fatalf("executor cancellation calls=%d task_ids=%v", calls, taskIDs)
	}
	if !observed {
		t.Fatal("executor signal ran before durable cancellation committed")
	}

	var artifact persistence.TaskArtifact
	if err := db.First(
		&artifact,
		"artifact_id = ?",
		"artifact-before-cancel",
	).Error; err != nil {
		t.Fatalf("pre-cancellation artifact was hidden or deleted: %v", err)
	}
	replayed, err := cancellation.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           "goal-cancel",
			ExpectedRevision: 4,
			IdempotencyKey:   "goal-active-cancel",
		},
	)
	if err != nil {
		t.Fatalf("replay running Goal cancellation: %v", err)
	}
	if replayed.GetRevision() != cancelled.GetRevision() {
		t.Fatalf("replayed cancellation revision = %d, want %d", replayed.GetRevision(), cancelled.GetRevision())
	}
	calls, _, _ = signal.snapshot()
	if calls != 1 {
		t.Fatalf("replayed cancellation signalled executor %d times", calls)
	}
}

type goalCancellationLateProvider struct {
	started  chan struct{}
	release  chan struct{}
	returned chan struct{}
}

func (p *goalCancellationLateProvider) CallDirectRunProvider(
	_ context.Context,
	_ *ProviderCallRequest,
) (*ProviderCallResponse, error) {
	close(p.started)
	<-p.release
	close(p.returned)
	return &ProviderCallResponse{
		Content:      "late result must be fenced",
		Model:        "gpt-4.1",
		Provider:     "openai",
		InputTokens:  3,
		OutputTokens: 5,
	}, nil
}

type goalCancellationPreparedStarter struct {
	executor *GoalDirectModelExecutor
}

func (s goalCancellationPreparedStarter) PrepareTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	execution *GoalExecutionSnapshot,
) error {
	return s.executor.PrepareTx(ctx, tx, goal, execution)
}

func (goalCancellationPreparedStarter) Start(string, string) {}

func TestRunningGoalLateResultCannotResurrectCancellation(t *testing.T) {
	db := openGoalDirectModelTestDB(t, "goal_active_cancel_late_result")
	if err := db.AutoMigrate(&persistence.GoalCoordinatorLease{}); err != nil {
		t.Fatalf("migrate Goal coordinator lease: %v", err)
	}
	seedGoalDirectModelAgent(t, db)
	provider := &goalCancellationLateProvider{
		started:  make(chan struct{}),
		release:  make(chan struct{}),
		returned: make(chan struct{}),
	}
	executor := NewGoalDirectModelExecutor(db, nil)
	executor.provider = provider
	goals := NewGoalService(db)
	executions := NewGoalExecutionService(db)
	admission := NewGoalAdmissionService(goals, executions)
	admission.SetExecutionStarter(goalCancellationPreparedStarter{
		executor: executor,
	})
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-late-result-admit",
		},
	)
	if err != nil {
		t.Fatalf("admit Goal: %v", err)
	}
	running, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		&model.StartAgentGoalRequest{
			GoalId:           ready.GetGoalId(),
			ExpectedRevision: ready.GetRevision(),
			IdempotencyKey:   "goal-late-result-start",
		},
	)
	if err != nil {
		t.Fatalf("start Goal: %v", err)
	}
	taskID := stableGoalExecutionID("task", running.GetGoalId())
	executionDone := make(chan error, 1)
	go func() {
		executionDone <- executor.Execute(
			context.Background(),
			"ptid:actor-1",
			taskID,
		)
	}()
	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Direct Model provider did not start")
	}

	coordinator := NewGoalCoordinator(db, executions, executor)
	cancellation := NewGoalCancellationService(goals, coordinator)
	cancelled, err := cancellation.Cancel(
		context.Background(),
		"ptid:actor-1",
		&model.CancelAgentGoalRequest{
			GoalId:           running.GetGoalId(),
			ExpectedRevision: running.GetRevision(),
			IdempotencyKey:   "goal-late-result-cancel",
		},
	)
	if err != nil {
		t.Fatalf("cancel running Goal: %v", err)
	}
	if cancelled.GetStatus() !=
		model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED {
		t.Fatalf("cancelled Goal = %+v", cancelled)
	}
	close(provider.release)
	select {
	case <-provider.returned:
	case <-time.After(2 * time.Second):
		t.Fatal("late provider result was not released")
	}
	select {
	case executeErr := <-executionDone:
		if executeErr != nil {
			t.Fatalf("cancelled execution returned an error: %v", executeErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled execution did not settle")
	}

	var goal persistence.AgentGoal
	var task persistence.TaskRun
	var step persistence.ExecutionStep
	var node persistence.AgentGoalNode
	var run persistence.DirectRun
	for target, query := range map[any]string{
		&goal: "goal_id = '" + running.GetGoalId() + "'",
		&task: "task_id = '" + taskID + "'",
		&step: "task_id = '" + taskID + "'",
		&node: "task_id = '" + taskID + "'",
		&run:  "task_id = '" + taskID + "'",
	} {
		if err := db.Where(query).First(target).Error; err != nil {
			t.Fatalf("read cancellation state %T: %v", target, err)
		}
	}
	if goal.Status != int32(
		model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED,
	) || task.Status != int32(
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED,
	) || step.Status != int32(
		model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED,
	) || node.Status != int32(
		model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED,
	) || run.State != "cancelled" {
		t.Fatalf(
			"late result changed terminal cancellation: goal=%d task=%d step=%d node=%d run=%s",
			goal.Status,
			task.Status,
			step.Status,
			node.Status,
			run.State,
		)
	}
	var artifactCount int64
	if err := db.Model(&persistence.TaskArtifact{}).
		Where("task_id = ?", taskID).
		Count(&artifactCount).Error; err != nil {
		t.Fatalf("count late-result artifacts: %v", err)
	}
	if artifactCount != 0 {
		t.Fatalf("late result committed %d artifacts after cancellation", artifactCount)
	}
}

func seedRunningGoalCancellationGraph(
	t *testing.T,
	db *gorm.DB,
	now time.Time,
) {
	t.Helper()
	goal := &persistence.AgentGoal{
		GoalID:                 "goal-cancel",
		OwnerPTID:              "ptid:actor-1",
		WorkspaceID:            "workspace-cancel",
		Title:                  "Cancel active work",
		Outcome:                "Stop without accepting a late result",
		NonGoalsJSON:           []byte("[]"),
		ConstraintsJSON:        []byte("[]"),
		BudgetJSON:             []byte("{}"),
		AcceptanceCriteriaJSON: []byte("[]"),
		Status: int32(
			model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING,
		),
		Revision:             4,
		GraphRevision:        1,
		CreateIdempotencyKey: "goal-cancel-create",
		CreatePayloadHash:    "goal-cancel-hash",
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	task := &persistence.TaskRun{
		TaskID:         "task-cancel",
		Title:          goal.Title,
		Description:    goal.Outcome,
		Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		OwnerActorPTID: goal.OwnerPTID,
		WorkspaceID:    goal.WorkspaceID,
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
		GoalID:         goal.GoalID,
		GoalNodeID:     "node-cancel",
		RootStepID:     "step-cancel",
	}
	step := &persistence.ExecutionStep{
		StepID:    task.RootStepID,
		TaskID:    task.TaskID,
		AgentID:   "agent-cancel",
		Role:      "executor",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		Attempt:   1,
		AttemptID: "attempt-cancel",
		StartedAt: now,
	}
	node := &persistence.AgentGoalNode{
		GoalID:                  goal.GoalID,
		NodeID:                  task.GoalNodeID,
		TaskID:                  task.TaskID,
		Title:                   goal.Title,
		Description:             goal.Outcome,
		Status:                  int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		PrerequisiteNodeIDsJSON: "[]",
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	run := &persistence.DirectRun{
		DirectRunID: "direct-run-cancel",
		TaskID:      task.TaskID,
		GoalID:      goal.GoalID,
		GoalNodeID:  node.NodeID,
		StepID:      step.StepID,
		AttemptID:   step.AttemptID,
		ProviderID:  "openai",
		ModelIntent: "gpt-4.1",
		State:       "running",
		Source:      goalDirectModelSource,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	lease := &persistence.GoalCoordinatorLease{
		GoalID:           goal.GoalID,
		OwnerID:          "coordinator-before-cancel",
		Generation:       1,
		GoalRevision:     goal.Revision,
		GraphRevision:    goal.GraphRevision,
		DispatchSequence: 1,
		Status:           persistence.GoalCoordinatorLeaseActive,
		AcquiredAt:       now,
		HeartbeatAt:      now,
		ExpiresAt:        now.Add(time.Minute),
		UpdatedAt:        now,
	}
	for name, value := range map[string]any{
		"Goal":              goal,
		"TaskRun":           task,
		"ExecutionStep":     step,
		"GoalNode":          node,
		"DirectRun":         run,
		"Coordinator lease": lease,
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}
}
