package service

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

type goalCoordinatorDispatcherStub struct {
	mu       sync.Mutex
	prepared []string
	started  []string
}

func (s *goalCoordinatorDispatcherStub) PrepareTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	execution *GoalExecutionSnapshot,
) error {
	s.mu.Lock()
	s.prepared = append(s.prepared, execution.Task.TaskID)
	s.mu.Unlock()
	now := time.Now().UTC()
	return tx.WithContext(ctx).Create(&persistence.DirectRun{
		DirectRunID: stableGoalExecutionID(
			"coordinator_run",
			execution.Task.TaskID,
		),
		TaskID:     execution.Task.TaskID,
		GoalID:     goal.GoalID,
		GoalNodeID: execution.Node.NodeID,
		StepID:     execution.Step.StepID,
		AttemptID:  execution.Step.AttemptID,
		State:      "pending_station_provider_route",
		Source:     "goal.coordinator.test",
		CreatedAt:  now,
		UpdatedAt:  now,
	}).Error
}

func (s *goalCoordinatorDispatcherStub) IsPreparedTx(
	ctx context.Context,
	tx *gorm.DB,
	execution *GoalExecutionSnapshot,
) (bool, error) {
	var count int64
	err := tx.WithContext(ctx).
		Model(&persistence.DirectRun{}).
		Where(
			"task_id = ? AND state IN ?",
			execution.Task.TaskID,
			[]string{"pending_station_provider_route", "running"},
		).
		Count(&count).Error
	return count > 0, err
}

func (s *goalCoordinatorDispatcherStub) Start(
	_ string,
	taskID string,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.started = append(s.started, taskID)
}

func (s *goalCoordinatorDispatcherStub) Cancel(string, string) error {
	return nil
}

func (s *goalCoordinatorDispatcherStub) snapshot() ([]string, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.prepared...), append([]string(nil), s.started...)
}

func TestGoalCoordinatorFrontierDispatchesDeterministicallyWithinConcurrency(
	t *testing.T,
) {
	db := openGoalCoordinatorTestDB(t)
	now := time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC)
	seedGoalCoordinatorGraph(
		t,
		db,
		now,
		[]goalCoordinatorNodeFixture{
			{id: "node-root", status: model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED},
			{id: "node-b", prerequisites: []string{"node-root"}, priority: 20},
			{id: "node-a", prerequisites: []string{"node-root"}, priority: 20},
			{id: "node-blocked", prerequisites: []string{"node-missing"}, priority: 100},
		},
	)
	dispatcher := &goalCoordinatorDispatcherStub{}
	coordinator := NewGoalCoordinator(
		db,
		NewGoalExecutionService(db),
		dispatcher,
	)
	coordinator.coordinatorID = "coordinator-a"
	coordinator.now = func() time.Time { return now }

	first, err := coordinator.Advance(
		context.Background(),
		"ptid:actor-1",
		"goal-frontier",
	)
	if err != nil {
		t.Fatalf("advance first ready frontier: %v", err)
	}
	if !first.LeaseOwned ||
		first.LeaseGeneration != 1 ||
		len(first.DispatchedTaskIDs) != 1 ||
		first.DispatchedTaskIDs[0] != "task-node-a" {
		t.Fatalf("first frontier result = %+v", first)
	}
	prepared, started := dispatcher.snapshot()
	if len(prepared) != 1 || prepared[0] != "task-node-a" ||
		len(started) != 1 || started[0] != "task-node-a" {
		t.Fatalf("first dispatch prepared=%v started=%v", prepared, started)
	}

	second, err := coordinator.Advance(
		context.Background(),
		"ptid:actor-1",
		"goal-frontier",
	)
	if err != nil {
		t.Fatalf("advance while first dispatch is pending: %v", err)
	}
	if len(second.DispatchedTaskIDs) != 0 {
		t.Fatalf("concurrency bound dispatched extra work: %+v", second)
	}

	completeCoordinatorNode(t, db, "node-a", now.Add(time.Second))
	third, err := coordinator.Advance(
		context.Background(),
		"ptid:actor-1",
		"goal-frontier",
	)
	if err != nil {
		t.Fatalf("advance second ready frontier: %v", err)
	}
	if third.LeaseGeneration != 1 ||
		len(third.DispatchedTaskIDs) != 1 ||
		third.DispatchedTaskIDs[0] != "task-node-b" {
		t.Fatalf("second frontier result = %+v", third)
	}
	var blocked persistence.AgentGoalNode
	if err := db.First(
		&blocked,
		"goal_id = ? AND node_id = ?",
		"goal-frontier",
		"node-blocked",
	).Error; err != nil {
		t.Fatalf("read blocked node: %v", err)
	}
	if blocked.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) {
		t.Fatalf("blocked node status = %d, want pending", blocked.Status)
	}

	var lease persistence.GoalCoordinatorLease
	if err := db.First(&lease, "goal_id = ?", "goal-frontier").Error; err != nil {
		t.Fatalf("read coordinator lease: %v", err)
	}
	if lease.Generation != 1 ||
		lease.DispatchSequence != 2 ||
		lease.GraphRevision != 1 {
		t.Fatalf("coordinator lease = %+v", lease)
	}
}

func TestGoalCoordinatorLeaseTakeoverReconcilesInflightBeforeDispatch(
	t *testing.T,
) {
	db := openGoalCoordinatorTestDB(t)
	now := time.Date(2026, 10, 5, 11, 0, 0, 0, time.UTC)
	seedGoalCoordinatorGraph(
		t,
		db,
		now,
		[]goalCoordinatorNodeFixture{
			{id: "node-running", status: model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING},
			{id: "node-ready", priority: 10},
		},
	)
	if err := db.Create(&persistence.DirectRun{
		DirectRunID: "direct-running",
		TaskID:      "task-node-running",
		GoalID:      "goal-frontier",
		GoalNodeID:  "node-running",
		StepID:      "step-node-running",
		AttemptID:   "attempt-node-running",
		State:       "running",
		Source:      "goal.coordinator.test",
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed active dispatch: %v", err)
	}

	firstDispatcher := &goalCoordinatorDispatcherStub{}
	first := NewGoalCoordinator(db, NewGoalExecutionService(db), firstDispatcher)
	first.coordinatorID = "coordinator-a"
	first.now = func() time.Time { return now }
	firstResult, err := first.Advance(
		context.Background(),
		"ptid:actor-1",
		"goal-frontier",
	)
	if err != nil {
		t.Fatalf("first coordinator advance: %v", err)
	}
	if !firstResult.LeaseOwned || firstResult.LeaseGeneration != 1 ||
		len(firstResult.DispatchedTaskIDs) != 0 {
		t.Fatalf("first coordinator result = %+v", firstResult)
	}

	secondDispatcher := &goalCoordinatorDispatcherStub{}
	second := NewGoalCoordinator(db, NewGoalExecutionService(db), secondDispatcher)
	second.coordinatorID = "coordinator-b"
	second.now = func() time.Time { return now.Add(time.Second) }
	blocked, err := second.Advance(
		context.Background(),
		"ptid:actor-1",
		"goal-frontier",
	)
	if err != nil {
		t.Fatalf("blocked coordinator advance: %v", err)
	}
	if blocked.LeaseOwned || blocked.LeaseGeneration != 1 {
		t.Fatalf("unexpired lease was stolen: %+v", blocked)
	}

	if err := db.Model(&persistence.GoalCoordinatorLease{}).
		Where("goal_id = ?", "goal-frontier").
		Update("expires_at", now.Add(-time.Second)).Error; err != nil {
		t.Fatalf("expire coordinator lease: %v", err)
	}
	second.now = func() time.Time { return now.Add(2 * time.Second) }
	takenOver, err := second.Advance(
		context.Background(),
		"ptid:actor-1",
		"goal-frontier",
	)
	if err != nil {
		t.Fatalf("take over coordinator lease: %v", err)
	}
	if !takenOver.LeaseOwned ||
		takenOver.LeaseGeneration != 2 ||
		len(takenOver.ReconciledTaskIDs) != 1 ||
		takenOver.ReconciledTaskIDs[0] != "task-node-running" ||
		len(takenOver.DispatchedTaskIDs) != 0 {
		t.Fatalf("takeover result = %+v", takenOver)
	}
	prepared, started := secondDispatcher.snapshot()
	if len(prepared) != 0 || len(started) != 0 {
		t.Fatalf("takeover dispatched before reconciliation: prepared=%v started=%v", prepared, started)
	}
}

func TestGoalCoordinatorDispatchPreallocatesDefaultTwoNodeGraph(
	t *testing.T,
) {
	db := openGoalCoordinatorTestDB(t)
	goals := NewGoalService(db)
	dispatcher := &goalCoordinatorDispatcherStub{}
	coordinator := NewGoalCoordinator(
		db,
		NewGoalExecutionService(db),
		dispatcher,
	)
	admission := NewGoalAdmissionService(goals)
	admission.SetExecutionStarter(coordinator)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-coordinator-admit",
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
			IdempotencyKey:   "goal-coordinator-start",
		},
	)
	if err != nil {
		t.Fatalf("start Goal through coordinator: %v", err)
	}

	var initialNodes []persistence.AgentGoalNode
	if err := db.Where("goal_id = ?", running.GetGoalId()).
		Order("priority DESC, node_id ASC").
		Find(&initialNodes).Error; err != nil {
		t.Fatalf("read initial Goal graph: %v", err)
	}
	if len(initialNodes) != 1 {
		t.Fatalf("initial Goal graph has %d nodes, want 1", len(initialNodes))
	}
	firstNode := initialNodes[0]
	if err := db.Model(&persistence.AgentGoalNode{}).
		Where("goal_id = ? AND node_id = ?", running.GetGoalId(), firstNode.NodeID).
		Update("status", int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)).Error; err != nil {
		t.Fatalf("complete initial Goal node: %v", err)
	}
	if err := db.Model(&persistence.TaskRun{}).
		Where("task_id = ?", firstNode.TaskID).
		Update(
			"status",
			int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		).Error; err != nil {
		t.Fatalf("complete initial TaskRun: %v", err)
	}
	if err := db.Model(&persistence.ExecutionStep{}).
		Where("task_id = ?", firstNode.TaskID).
		Update("status", int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)).Error; err != nil {
		t.Fatalf("complete initial ExecutionStep: %v", err)
	}
	if err := db.Model(&persistence.DirectRun{}).
		Where("task_id = ?", firstNode.TaskID).
		Update("state", "succeeded").Error; err != nil {
		t.Fatalf("complete initial runtime: %v", err)
	}
	advanced, err := coordinator.Advance(
		context.Background(),
		"ptid:actor-1",
		running.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("advance completed initial node: %v", err)
	}
	if len(advanced.DispatchedTaskIDs) != 1 {
		t.Fatalf("continuation dispatch = %+v", advanced)
	}

	var nodes []persistence.AgentGoalNode
	if err := db.Where("goal_id = ?", running.GetGoalId()).
		Order("priority DESC, node_id ASC").
		Find(&nodes).Error; err != nil {
		t.Fatalf("read expanded Goal graph: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("expanded Goal graph has %d nodes, want 2", len(nodes))
	}
	if nodes[0].TaskID == "" || nodes[1].TaskID == "" ||
		nodes[0].TaskID == nodes[1].TaskID {
		t.Fatalf("Goal graph TaskRun identities = %+v", nodes)
	}
	var prerequisites []string
	if err := json.Unmarshal(
		[]byte(nodes[1].PrerequisiteNodeIDsJSON),
		&prerequisites,
	); err != nil {
		t.Fatalf("decode continuation prerequisites: %v", err)
	}
	if len(prerequisites) != 1 || prerequisites[0] != nodes[0].NodeID {
		t.Fatalf("continuation prerequisites = %v, want %s", prerequisites, nodes[0].NodeID)
	}
	var tasks int64
	if err := db.Model(&persistence.TaskRun{}).
		Where("goal_id = ?", running.GetGoalId()).
		Count(&tasks).Error; err != nil {
		t.Fatalf("count Goal TaskRuns: %v", err)
	}
	var steps int64
	if err := db.Model(&persistence.ExecutionStep{}).
		Joins("JOIN agent_task_runs ON agent_task_runs.task_id = agent_execution_steps.task_id").
		Where("agent_task_runs.goal_id = ?", running.GetGoalId()).
		Count(&steps).Error; err != nil {
		t.Fatalf("count Goal ExecutionSteps: %v", err)
	}
	if tasks != 2 || steps != 2 {
		t.Fatalf("preallocated identities: TaskRuns=%d ExecutionSteps=%d", tasks, steps)
	}
	prepared, started := dispatcher.snapshot()
	if len(prepared) != 2 || len(started) != 2 ||
		prepared[0] != nodes[0].TaskID || started[0] != nodes[0].TaskID ||
		prepared[1] != nodes[1].TaskID || started[1] != nodes[1].TaskID {
		t.Fatalf("Goal dispatch prepared=%v started=%v nodes=%+v", prepared, started, nodes)
	}
}

func TestGoalCoordinatorDispatchAdvancesAfterTerminalTaskWithoutContinue(
	t *testing.T,
) {
	db := openGoalDirectModelTestDB(t, "goal_coordinator_terminal_advance")
	if err := db.AutoMigrate(&persistence.GoalCoordinatorLease{}); err != nil {
		t.Fatalf("migrate Goal coordinator lease: %v", err)
	}
	seedGoalDirectModelAgent(t, db)
	provider := &goalDirectModelProviderStub{
		started: make(chan *ProviderCallRequest, 2),
		release: make(chan struct{}),
		resp: &ProviderCallResponse{
			Content:      "Coordinator result",
			Model:        "gpt-4.1",
			Provider:     "openai",
			InputTokens:  5,
			OutputTokens: 8,
		},
	}
	executor := NewGoalDirectModelExecutor(db, nil)
	executor.provider = provider
	executions := NewGoalExecutionService(db)
	coordinator := NewGoalCoordinator(db, executions, executor)
	executor.SetGoalTerminalObserver(coordinator)
	admission := NewGoalAdmissionService(NewGoalService(db), executions)
	admission.SetExecutionStarter(coordinator)
	reviewed := createReviewedGoal(t, admission.goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-coordinator-runtime-admit",
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
			IdempotencyKey:   "goal-coordinator-runtime-start",
		},
	)
	if err != nil {
		t.Fatalf("start Goal: %v", err)
	}

	var first *ProviderCallRequest
	select {
	case first = <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first Goal node did not start")
	}
	close(provider.release)
	var second *ProviderCallRequest
	select {
	case second = <-provider.started:
	case <-time.After(3 * time.Second):
		t.Fatal("second Goal node did not advance automatically")
	}
	if len(first.Messages) == 0 ||
		len(second.Messages) == 0 ||
		first.Messages[0].Content == second.Messages[0].Content {
		t.Fatalf("sequential provider calls first=%+v second=%+v", first, second)
	}
	secondTaskID := stableGoalExecutionID(
		"task",
		running.GetGoalId()+"\x00continuation",
	)
	waitForGoalDirectModelTaskStatus(
		t,
		db,
		secondTaskID,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
	)
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d, want 2", provider.callCount())
	}

	var lease persistence.GoalCoordinatorLease
	if err := db.First(&lease, "goal_id = ?", running.GetGoalId()).Error; err != nil {
		t.Fatalf("read coordinator lease: %v", err)
	}
	if lease.Generation != 1 || lease.DispatchSequence != 2 {
		t.Fatalf("terminal advance lease = %+v", lease)
	}
	var events []persistence.TaskEvent
	deadline := time.Now().Add(time.Second)
	for {
		err := db.Where("task_id = ?", secondTaskID).
			Order("event_seq ASC").
			Find(&events).Error
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("read continuation events: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(events) == 0 {
		t.Fatal("continuation emitted no durable events")
	}
	for _, event := range events {
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			t.Fatalf("decode continuation event %s: %v", event.ID, err)
		}
		if payload["coordinator_lease_generation"] != float64(1) ||
			payload["coordinator_dispatch_sequence"] != float64(2) ||
			payload["goal_graph_revision"] != float64(2) {
			t.Fatalf("continuation coordinator readback = %+v", payload)
		}
	}
}

func TestGoalCoordinatorDispatchRejectsUnavailableCapabilityWithoutMutation(
	t *testing.T,
) {
	db := openGoalDirectModelTestDB(t, "goal_coordinator_capability_reject")
	if err := db.AutoMigrate(&persistence.GoalCoordinatorLease{}); err != nil {
		t.Fatalf("migrate Goal coordinator lease: %v", err)
	}
	goals := NewGoalService(db)
	executor := NewGoalDirectModelExecutor(db, nil)
	coordinator := NewGoalCoordinator(
		db,
		NewGoalExecutionService(db),
		executor,
	)
	admission := NewGoalAdmissionService(goals)
	admission.SetExecutionStarter(coordinator)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-coordinator-capability-admit",
		},
	)
	if err != nil {
		t.Fatalf("admit Goal: %v", err)
	}
	_, err = admission.Start(
		context.Background(),
		"ptid:actor-1",
		&model.StartAgentGoalRequest{
			GoalId:           ready.GetGoalId(),
			ExpectedRevision: ready.GetRevision(),
			IdempotencyKey:   "goal-coordinator-capability-start",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentGoalAdmissionRejected)

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		ready.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read Goal after rejected dispatch: %v", err)
	}
	if reopened.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_READY ||
		reopened.GetRevision() != ready.GetRevision() {
		t.Fatalf("rejected dispatch mutated Goal: %+v", reopened)
	}
	for name, modelValue := range map[string]any{
		"TaskRun":          &persistence.TaskRun{},
		"GoalNode":         &persistence.AgentGoalNode{},
		"ExecutionStep":    &persistence.ExecutionStep{},
		"CoordinatorLease": &persistence.GoalCoordinatorLease{},
	} {
		var count int64
		if err := db.Model(modelValue).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("rejected dispatch wrote %d %s rows", count, name)
		}
	}
}

type goalCoordinatorNodeFixture struct {
	id            string
	prerequisites []string
	priority      int32
	status        model.TaskNodeStatus
}

func openGoalCoordinatorTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := openGoalServiceTestDB(t)
	if err := db.AutoMigrate(&persistence.GoalCoordinatorLease{}); err != nil {
		t.Fatalf("migrate Goal coordinator lease: %v", err)
	}
	return db
}

func seedGoalCoordinatorGraph(
	t *testing.T,
	db *gorm.DB,
	now time.Time,
	fixtures []goalCoordinatorNodeFixture,
) {
	t.Helper()
	budgetJSON, err := json.Marshal(&model.AgentGoalBudget{
		MaxTokens:        100_000,
		WallTimeMs:       3_600_000,
		MaxParallelTasks: 1,
	})
	if err != nil {
		t.Fatalf("encode Goal budget: %v", err)
	}
	if err := db.Create(&persistence.AgentGoal{
		GoalID:                 "goal-frontier",
		OwnerPTID:              "ptid:actor-1",
		Title:                  "Coordinate work",
		Outcome:                "Advance eligible nodes",
		NonGoalsJSON:           []byte("[]"),
		ConstraintsJSON:        []byte("[]"),
		BudgetJSON:             budgetJSON,
		AcceptanceCriteriaJSON: []byte(`[{"criterion_id":"done","description":"done","evaluator":"deterministic","required":true}]`),
		Status:                 int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING),
		Revision:               7,
		GraphRevision:          1,
		AcceptanceRevision:     1,
		CreateIdempotencyKey:   "goal-frontier-create",
		CreatePayloadHash:      "goal-frontier-hash",
		CreatedAt:              now,
		UpdatedAt:              now,
	}).Error; err != nil {
		t.Fatalf("seed Goal: %v", err)
	}
	for _, fixture := range fixtures {
		status := fixture.status
		if status == model.TaskNodeStatus_TASK_NODE_STATUS_UNSPECIFIED {
			status = model.TaskNodeStatus_TASK_NODE_STATUS_PENDING
		}
		prerequisites, err := json.Marshal(fixture.prerequisites)
		if err != nil {
			t.Fatalf("encode prerequisites: %v", err)
		}
		taskStatus := model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING
		if status == model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING {
			taskStatus = model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING
		}
		if status == model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED {
			taskStatus = model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED
		}
		taskID := "task-" + fixture.id
		stepID := "step-" + fixture.id
		if err := db.Create(&persistence.AgentGoalNode{
			GoalID:                  "goal-frontier",
			NodeID:                  fixture.id,
			TaskID:                  taskID,
			Title:                   fixture.id,
			Description:             fixture.id,
			Status:                  int32(status),
			PrerequisiteNodeIDsJSON: string(prerequisites),
			Priority:                fixture.priority,
			CreatedAt:               now,
			UpdatedAt:               now,
		}).Error; err != nil {
			t.Fatalf("seed Goal node %s: %v", fixture.id, err)
		}
		if err := db.Create(&persistence.TaskRun{
			TaskID:         taskID,
			Title:          fixture.id,
			Description:    fixture.id,
			Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
			Status:         int32(taskStatus),
			OwnerActorPTID: "ptid:actor-1",
			GoalID:         "goal-frontier",
			GoalNodeID:     fixture.id,
			RootStepID:     stepID,
			CreatedAt:      now,
			StartedAt:      now,
			UpdatedAt:      now,
		}).Error; err != nil {
			t.Fatalf("seed TaskRun %s: %v", taskID, err)
		}
		if err := db.Create(&persistence.ExecutionStep{
			StepID:    stepID,
			TaskID:    taskID,
			Role:      "executor",
			Status:    int32(status),
			Attempt:   1,
			AttemptID: "attempt-" + fixture.id,
			StartedAt: now,
		}).Error; err != nil {
			t.Fatalf("seed ExecutionStep %s: %v", stepID, err)
		}
	}
}

func completeCoordinatorNode(
	t *testing.T,
	db *gorm.DB,
	nodeID string,
	now time.Time,
) {
	t.Helper()
	taskID := "task-" + nodeID
	if err := db.Model(&persistence.AgentGoalNode{}).
		Where("goal_id = ? AND node_id = ?", "goal-frontier", nodeID).
		Updates(map[string]any{
			"status":     int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			"updated_at": now,
		}).Error; err != nil {
		t.Fatalf("complete Goal node: %v", err)
	}
	if err := db.Model(&persistence.TaskRun{}).
		Where("task_id = ?", taskID).
		Updates(map[string]any{
			"status":     int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
			"updated_at": now,
		}).Error; err != nil {
		t.Fatalf("complete TaskRun: %v", err)
	}
	if err := db.Model(&persistence.ExecutionStep{}).
		Where("task_id = ?", taskID).
		Updates(map[string]any{
			"status": int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		}).Error; err != nil {
		t.Fatalf("complete ExecutionStep: %v", err)
	}
	if err := db.Model(&persistence.DirectRun{}).
		Where("task_id = ?", taskID).
		Updates(map[string]any{
			"state":      "succeeded",
			"updated_at": now,
		}).Error; err != nil {
		t.Fatalf("complete dispatch runtime: %v", err)
	}
}
