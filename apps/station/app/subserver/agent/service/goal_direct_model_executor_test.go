package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

type goalDirectModelProviderStub struct {
	mu      sync.Mutex
	calls   int
	started chan *ProviderCallRequest
	release chan struct{}
	resp    *ProviderCallResponse
	err     error
}

func (s *goalDirectModelProviderStub) CallDirectRunProvider(
	_ context.Context,
	req *ProviderCallRequest,
) (*ProviderCallResponse, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	if s.started != nil {
		s.started <- req
	}
	if s.release != nil {
		<-s.release
	}
	return s.resp, s.err
}

func (s *goalDirectModelProviderStub) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func TestGoalDirectModelSuccessRunsCanonicalAttemptAndPreservesGoalState(
	t *testing.T,
) {
	db := openGoalDirectModelTestDB(t, "goal_direct_model_success")
	seedGoalDirectModelAgent(t, db)
	provider := &goalDirectModelProviderStub{
		started: make(chan *ProviderCallRequest, 1),
		release: make(chan struct{}),
		resp: &ProviderCallResponse{
			Content:         "## Result\n\nDurable Direct Model output.",
			Model:           "gpt-4.1",
			Provider:        "openai",
			InputTokens:     13,
			OutputTokens:    21,
			BilledMoney:     0.05,
			BillingSource:   "provider.response.invoice",
			BillingCurrency: "USD",
			FinishReason:    "stop",
		},
	}
	executor := NewGoalDirectModelExecutor(db, nil)
	executor.provider = provider
	admission, running := startGoalWithDirectModel(t, db, executor)

	var request *ProviderCallRequest
	select {
	case request = <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Direct Model provider was not called")
	}
	if request.AgentID != "agent-direct" ||
		request.ProviderID != "openai" ||
		request.Model != "gpt-4.1" ||
		request.UserID != "ptid:actor-1" ||
		request.MaxOutputTokens != 100_000 {
		t.Fatalf("provider request = %+v", request)
	}

	taskID := stableGoalExecutionID("task", running.GetGoalId())
	assertGoalDirectModelTaskStatus(
		t,
		db,
		taskID,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
	)
	close(provider.release)
	waitForGoalDirectModelTaskStatus(
		t,
		db,
		taskID,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
	)

	execution, err := admission.executions.GetForOwner(
		context.Background(),
		"ptid:actor-1",
		taskID,
	)
	if err != nil {
		t.Fatalf("read completed Goal execution: %v", err)
	}
	if execution.Step.Status != int32(
		model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
	) || execution.Node.Status != int32(
		model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
	) || !strings.Contains(
		execution.Step.ResultSummary,
		"Durable Direct Model output",
	) {
		t.Fatalf("terminal execution = %+v", execution)
	}
	if execution.Result == nil ||
		execution.Result.State != "succeeded" ||
		execution.Result.ArtifactID == "" ||
		execution.Result.ArtifactBodyRef == "" ||
		execution.Result.TotalTokens != 34 ||
		execution.Result.TraceID == "" {
		t.Fatalf("Goal result projection = %+v", execution.Result)
	}

	var goal persistence.AgentGoal
	if err := db.First(&goal, "goal_id = ?", running.GetGoalId()).Error; err != nil {
		t.Fatalf("read Goal after Direct Model success: %v", err)
	}
	if goal.Status != int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING) {
		t.Fatalf("executor set Goal terminal state: %+v", goal)
	}
	assertNoLegacyGoalTaskWrites(t, db)

	var usage persistence.TaskBudgetUsage
	if err := db.First(
		&usage,
		"task_id = ? AND direct_run_id = ?",
		taskID,
		execution.Result.DirectRunID,
	).Error; err != nil {
		t.Fatalf("read Direct Model usage: %v", err)
	}
	if usage.TotalTokens != 34 ||
		usage.Source != "station.goal.direct_model" ||
		usage.EventID == "" {
		t.Fatalf("Direct Model usage = %+v", usage)
	}

	var realtimeEvents []persistence.AgentRealtimeOutbox
	if err := db.Where("task_id = ?", taskID).
		Order("domain_sequence ASC").
		Find(&realtimeEvents).Error; err != nil {
		t.Fatalf("read Direct Model realtime outbox: %v", err)
	}
	if len(realtimeEvents) == 0 {
		t.Fatal("Direct Model task events were not queued for canonical realtime")
	}
	seenRunning := false
	seenCompleted := false
	var previousGoalRevision uint64
	for _, event := range realtimeEvents {
		if event.GoalID != running.GetGoalId() ||
			event.GoalRevision == 0 ||
			event.GoalRevision < previousGoalRevision ||
			event.GoalRevision > running.GetRevision() ||
			event.TargetActorPTID != "ptid:actor-1" {
			t.Fatalf("Direct Model realtime identity = %+v", event)
		}
		previousGoalRevision = event.GoalRevision
		switch event.EventType {
		case string(domain.EventTypeCollaborationNodeRunning):
			seenRunning = true
		case string(domain.EventTypeCollaborationTaskCompleted):
			seenCompleted = event.EventClass ==
				persistence.AgentRealtimeClassTerminal &&
				event.GoalRevision == running.GetRevision()
		}
	}
	if !seenRunning || !seenCompleted {
		t.Fatalf("Direct Model realtime events = %+v", realtimeEvents)
	}
}

func TestGoalDirectModelProviderFailurePersistsFailureArtifactAndKeepsGoalRunning(
	t *testing.T,
) {
	db := openGoalDirectModelTestDB(t, "goal_direct_model_failure")
	seedGoalDirectModelAgent(t, db)
	provider := &goalDirectModelProviderStub{
		resp: nil,
		err:  errors.New("provider unavailable"),
	}
	executor := NewGoalDirectModelExecutor(db, nil)
	executor.provider = provider
	_, running := startGoalWithDirectModel(t, db, executor)
	taskID := stableGoalExecutionID("task", running.GetGoalId())

	waitForGoalDirectModelTaskStatus(
		t,
		db,
		taskID,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
	)
	var artifact persistence.TaskArtifact
	if err := db.First(
		&artifact,
		"task_id = ? AND kind = ?",
		taskID,
		"direct_run.failure",
	).Error; err != nil {
		t.Fatalf("read Direct Model failure artifact: %v", err)
	}
	var blob persistence.TaskArtifactBlob
	if err := db.First(&blob, "artifact_id = ?", artifact.ArtifactID).Error; err != nil {
		t.Fatalf("read Direct Model failure body: %v", err)
	}
	if !strings.Contains(blob.BodyText, "provider execution failed") {
		t.Fatalf("failure body = %q", blob.BodyText)
	}
	var goal persistence.AgentGoal
	if err := db.First(&goal, "goal_id = ?", running.GetGoalId()).Error; err != nil {
		t.Fatalf("read Goal after Direct Model failure: %v", err)
	}
	if goal.Status != int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING) {
		t.Fatalf("failed executor set Goal terminal state: %+v", goal)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	assertNoLegacyGoalTaskWrites(t, db)
}

func TestGoalDirectModelStartReplayDoesNotDispatchAgain(t *testing.T) {
	db := openGoalDirectModelTestDB(t, "goal_direct_model_replay")
	seedGoalDirectModelAgent(t, db)
	provider := &goalDirectModelProviderStub{
		started: make(chan *ProviderCallRequest, 1),
		release: make(chan struct{}),
		resp: &ProviderCallResponse{
			Content: "Replay-safe result",
			Model:   "gpt-4.1",
		},
	}
	executor := NewGoalDirectModelExecutor(db, nil)
	executor.provider = provider

	goals := NewGoalService(db)
	admission := NewGoalAdmissionService(goals)
	admission.SetDirectModelExecutor(executor)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-direct-replay-admit",
		},
	)
	if err != nil {
		t.Fatalf("admit Goal: %v", err)
	}
	request := &model.StartAgentGoalRequest{
		GoalId:           ready.GetGoalId(),
		ExpectedRevision: ready.GetRevision(),
		IdempotencyKey:   "goal-direct-replay-start",
	}
	running, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		request,
	)
	if err != nil {
		t.Fatalf("start Goal: %v", err)
	}
	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Direct Model provider was not called")
	}
	if _, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		request,
	); err != nil {
		t.Fatalf("replay Goal start: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if provider.callCount() != 1 {
		t.Fatalf("replayed Start dispatched %d provider calls", provider.callCount())
	}
	close(provider.release)
	waitForGoalDirectModelTaskStatus(
		t,
		db,
		stableGoalExecutionID("task", running.GetGoalId()),
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
	)
}

func TestGoalDirectModelTaskEventsAuthorizeCanonicalTaskRunOwner(t *testing.T) {
	db := openGoalDirectModelTestDB(t, "goal_direct_model_event_readback")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	if err := db.Create(&persistence.TaskRun{
		TaskID:         "task-goal-events",
		Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		OwnerActorPTID: "ptid:actor-1",
		GoalID:         "goal-events",
		GoalNodeID:     "node-events",
		RootStepID:     "step-events",
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed canonical TaskRun: %v", err)
	}
	if err := db.Create(&persistence.TaskEvent{
		ID:        "event-goal-events",
		TaskID:    "task-goal-events",
		StepID:    "step-events",
		EventSeq:  1,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED),
		Payload:   `{"artifact_id":"artifact-events"}`,
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed canonical TaskRun event: %v", err)
	}

	service := NewOrchestrationService(nil, nil, nil)
	events, _, err := service.ListTaskEvents(
		context.Background(),
		"ptid:actor-1",
		&model.ListTaskEventsRequest{TaskId: "task-goal-events"},
	)
	if err != nil {
		t.Fatalf("list canonical TaskRun events: %v", err)
	}
	if len(events) != 1 || events[0].GetEventId() != "event-goal-events" {
		t.Fatalf("canonical TaskRun events = %+v", events)
	}
	if _, _, err := service.ListTaskEvents(
		context.Background(),
		"ptid:actor-2",
		&model.ListTaskEventsRequest{TaskId: "task-goal-events"},
	); err == nil {
		t.Fatal("foreign actor listed canonical TaskRun events")
	}
}

func startGoalWithDirectModel(
	t *testing.T,
	db *gorm.DB,
	executor *GoalDirectModelExecutor,
) (*GoalAdmissionService, *model.AgentGoal) {
	t.Helper()
	goals := NewGoalService(db)
	admission := NewGoalAdmissionService(goals)
	admission.SetDirectModelExecutor(executor)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-direct-admit-" + reviewed.GetGoalId(),
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
			IdempotencyKey:   "goal-direct-start-" + ready.GetGoalId(),
		},
	)
	if err != nil {
		t.Fatalf("start Goal: %v", err)
	}
	return admission, running
}

func openGoalDirectModelTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db := openResumeCollaborationTaskDB(t, name)
	if err := db.AutoMigrate(
		&persistence.AgentGoal{},
		&persistence.AgentGoalNode{},
		&persistence.AgentGoalEvent{},
		&persistence.AgentRealtimeActorCursor{},
		&persistence.AgentRealtimeOutbox{},
		&persistence.RevisionCommand{},
		&persistence.AgentTask{},
		&persistence.DirectRun{},
	); err != nil {
		t.Fatalf("migrate Goal Direct Model test database: %v", err)
	}
	return db
}

func seedGoalDirectModelAgent(t *testing.T, db *gorm.DB) {
	t.Helper()
	now := time.Now().UTC()
	if err := db.Create(&persistence.AgentProvider{
		ID:          "provider-direct",
		ActorPTID:   "ptid:actor-1",
		Name:        "openai",
		Config:      json.RawMessage(`{"pricing":{"input_token_usd":0.001,"output_token_usd":0.002}}`),
		SourceType:  "openai",
		RuntimeKind: "station",
		Protocol:    "openai",
		Enabled:     true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed Goal Direct Model provider: %v", err)
	}
	if err := db.Create(&persistence.Agent{
		ID:             "agent-direct",
		Name:           "direct",
		Title:          "Direct Agent",
		ProviderID:     "openai",
		ModelName:      "gpt-4.1",
		Effort:         "medium",
		ThinkingMode:   string(domain.ThinkingModeAuto),
		Visibility:     string(domain.AgentVisibilityPrivate),
		OwnerActorPTID: "ptid:actor-1",
		ConfigJSON:     `{"pinned":true}`,
		Version:        1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed Goal Direct Model Agent: %v", err)
	}
}

func waitForGoalDirectModelTaskStatus(
	t *testing.T,
	db *gorm.DB,
	taskID string,
	status model.CollaborationTaskStatus,
) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var task persistence.TaskRun
		if err := db.First(&task, "task_id = ?", taskID).Error; err == nil &&
			task.Status == int32(status) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	assertGoalDirectModelTaskStatus(t, db, taskID, status)
}

func assertGoalDirectModelTaskStatus(
	t *testing.T,
	db *gorm.DB,
	taskID string,
	status model.CollaborationTaskStatus,
) {
	t.Helper()
	var task persistence.TaskRun
	if err := db.First(&task, "task_id = ?", taskID).Error; err != nil {
		t.Fatalf("read Goal TaskRun: %v", err)
	}
	if task.Status != int32(status) {
		t.Fatalf("TaskRun status = %s, want %s", model.CollaborationTaskStatus(task.Status), status)
	}
}

func assertNoLegacyGoalTaskWrites(t *testing.T, db *gorm.DB) {
	t.Helper()
	var agentTasks int64
	if err := db.Model(&persistence.AgentTask{}).Count(&agentTasks).Error; err != nil {
		t.Fatalf("count AgentTasks: %v", err)
	}
	var collaborationTasks int64
	if err := db.Model(&persistence.CollaborationTask{}).
		Count(&collaborationTasks).Error; err != nil {
		t.Fatalf("count CollaborationTasks: %v", err)
	}
	if agentTasks != 0 || collaborationTasks != 0 {
		t.Fatalf(
			"Goal Direct Model wrote legacy tasks: AgentTask=%d CollaborationTask=%d",
			agentTasks,
			collaborationTasks,
		)
	}
}
