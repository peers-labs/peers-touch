package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
)

func TestGateRunnerProducesBlockingGateDecision(t *testing.T) {
	now := time.Now()
	task := &persistence.CollaborationTask{
		ID:            "task-gate-runner",
		Title:         "gate runner",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := &persistence.CollaborationTaskNode{
		ID:        "node-gate-runner",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}

	result, err := NewGateRunner(nil).Run(context.Background(), GateRunRequest{
		Task:        task,
		Node:        node,
		ProducedBy:  "station.gate_runner",
		GateID:      "gate-contract",
		Name:        "Contract Gate",
		Blocking:    true,
		ArtifactIDs: []string{"artifact-contract"},
		Checks: []GateCheck{{
			Name:   "contract",
			Type:   "failed",
			Detail: "projection contract failed",
		}},
	})
	if err != nil {
		t.Fatalf("run gate: %v", err)
	}
	if !result.Decision.Blocked || result.Decision.GateID != "gate-contract" {
		t.Fatalf("expected blocking gate decision, got %+v", result.Decision)
	}
	if result.Gate == nil || result.Gate.GetGateId() != "gate-contract" || result.Gate.GetChecks()[0].GetStatus() != "failed" {
		t.Fatalf("expected typed gate result, got %+v", result.Gate)
	}
	if result.Event.Payload["source"] != "station.gate_runner" ||
		result.Event.Payload["status"] != "failed" ||
		result.Event.Payload["blocking"] != true {
		t.Fatalf("unexpected gate runner payload: %+v", result.Event.Payload)
	}
}

func TestGateRunnerRunPlanProducesTypedResultsWithPlanLink(t *testing.T) {
	now := time.Now()
	task := &persistence.CollaborationTask{
		ID:            "task-gate-plan",
		Title:         "gate plan",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := &persistence.CollaborationTaskNode{
		ID:        "node-gate-plan",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}

	results, err := NewGateRunner(nil).RunPlan(context.Background(), GatePlanRunRequest{
		Task:       task,
		Node:       node,
		ProducedBy: "station.gate_runner",
		Plan: &model.TaskGatePlan{
			GatePlanId: "plan-contract",
			TaskId:     task.ID,
			StepId:     node.ID,
			Source:     "station.gate_runner",
			Status:     "active",
			Gates: []*model.TaskGateSpec{{
				GateId:        "gate-contract",
				Name:          "Contract Gate",
				BlockingLevel: model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_WARN,
				ArtifactIds:   []string{"artifact-contract"},
				Checks: []*model.TaskGateCheckSpec{{
					CheckId:   "check-contract",
					Name:      "contract",
					CheckType: "failed",
					Detail:    "projection contract failed",
				}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("run gate plan: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected one gate result, got %d", len(results))
	}
	result := results[0]
	if result.Decision.Blocked {
		t.Fatalf("expected failed non-blocking gate not to block, got %+v", result.Decision)
	}
	if result.Gate.GetGatePlanId() != "plan-contract" {
		t.Fatalf("expected gate plan link, got %q", result.Gate.GetGatePlanId())
	}
	if result.Payload["gate_plan_id"] != "plan-contract" {
		t.Fatalf("expected payload gate_plan_id, got %+v", result.Payload)
	}
}

func TestGateRunnerRunPlanUsesTypedGateAndProviderSpecs(t *testing.T) {
	now := time.Now()
	task := &persistence.CollaborationTask{
		ID:            "task-gate-typed",
		Title:         "gate typed",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := &persistence.CollaborationTaskNode{
		ID:        "node-gate-typed",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}

	results, err := NewGateRunner(nil).RunPlan(context.Background(), GatePlanRunRequest{
		Task:       task,
		Node:       node,
		ProducedBy: "station.gate_runner",
		Plan: &model.TaskGatePlan{
			GatePlanId: "plan-typed",
			TaskId:     task.ID,
			StepId:     node.ID,
			Source:     "station.gate_runner",
			Status:     "active",
			Gates: []*model.TaskGateSpec{{
				GateId:        "gate-typed",
				Name:          "Typed Gate",
				BlockingLevel: model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK,
				TypedGateType: model.TaskGateType_TASK_GATE_TYPE_CONTRACT,
				EvaluatorSpec: &model.TaskGateEvaluatorSpec{
					Kind:        model.TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_PROVIDER,
					EvaluatorId: "verifier-provider",
					Provider: &model.TaskProviderSpec{
						ProviderId:           "openai",
						Model:                "gpt-4.1",
						ReasoningEffort:      "medium",
						RequiredCapabilities: []string{"structured-output"},
					},
					RequiredCapabilities: []string{"gate-evaluation"},
				},
				Checks: []*model.TaskGateCheckSpec{{
					CheckId:        "check-contract",
					Name:           "contract",
					CheckType:      "legacy-should-not-win",
					TypedCheckType: model.TaskGateCheckType_TASK_GATE_CHECK_TYPE_CONTRACT_GATE,
					Detail:         "typed contract gate",
				}},
			}},
		},
	})
	if err != nil {
		t.Fatalf("run typed gate plan: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected one typed gate result, got %d", len(results))
	}
	result := results[0]
	if result.Decision.Blocked {
		t.Fatalf("expected typed contract-gate check to override legacy failure and avoid blocking, got %+v", result.Decision)
	}
	checks := result.Gate.GetChecks()
	if len(checks) != 1 || checks[0].GetStatus() != "passed" {
		t.Fatalf("expected typed contract-gate check to pass, got %+v", checks)
	}
	for key, want := range map[string]interface{}{
		"gate_type":        "contract",
		"evaluator_kind":   "provider",
		"evaluator_id":     "verifier-provider",
		"provider_id":      "openai",
		"model":            "gpt-4.1",
		"reasoning_effort": "medium",
	} {
		if got := result.Payload[key]; got != want {
			t.Fatalf("expected payload %s=%v, got %v in %+v", key, want, got, result.Payload)
		}
	}
	if got, ok := result.Payload["provider_capabilities"].([]string); !ok || len(got) != 1 || got[0] != "structured-output" {
		t.Fatalf("expected typed provider capabilities, got %+v", result.Payload["provider_capabilities"])
	}
	if got, ok := result.Payload["evaluator_capabilities"].([]string); !ok || len(got) != 1 || got[0] != "gate-evaluation" {
		t.Fatalf("expected typed evaluator capabilities, got %+v", result.Payload["evaluator_capabilities"])
	}
}

func TestGatePlanFromPersistence(t *testing.T) {
	planJSON, err := protojson.Marshal(&model.TaskGatePlan{
		GatePlanId: "plan-typecheck",
		TaskId:     "task-typecheck",
		StepId:     "node-typecheck",
		Source:     "station.gate_runner",
		Status:     "active",
		Gates: []*model.TaskGateSpec{{
			GateId:        "gate-typecheck",
			Name:          "Typecheck",
			BlockingLevel: model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK,
			Checks: []*model.TaskGateCheckSpec{{
				CheckId:   "check-tsc",
				Name:      "tsc",
				CheckType: "typecheck",
				Detail:    "tsc --noEmit",
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal gate plan: %v", err)
	}
	plan, err := GatePlanFromPersistence(persistence.TaskGatePlan{
		GatePlanID: "plan-typecheck",
		TaskID:     "task-typecheck",
		StepID:     "node-typecheck",
		Source:     "station.gate_runner",
		Status:     "active",
		PlanJSON:   string(planJSON),
	})
	if err != nil {
		t.Fatalf("convert gate plan: %v", err)
	}
	if plan.GetGatePlanId() != "plan-typecheck" || len(plan.GetGates()) != 1 || plan.GetGates()[0].GetChecks()[0].GetCheckType() != "typecheck" {
		t.Fatalf("unexpected gate plan: %+v", plan)
	}
}

func TestTaskGatePlanPersistenceRoundTrip(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "gate_plan_persistence")
	planJSON, err := protojson.Marshal(&model.TaskGatePlan{
		GatePlanId: "plan-persisted",
		TaskId:     "task-persisted",
		StepId:     "node-persisted",
		Source:     "station.gate_runner",
		Status:     "active",
		Gates: []*model.TaskGateSpec{{
			GateId:        "gate-persisted",
			Name:          "Persisted Gate",
			BlockingLevel: model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK,
			Checks: []*model.TaskGateCheckSpec{{
				CheckId:   "check-persisted",
				Name:      "persisted",
				CheckType: "schema",
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal gate plan: %v", err)
	}
	now := time.Now()
	record := persistence.TaskGatePlan{
		GatePlanID: "plan-persisted",
		TaskID:     "task-persisted",
		StepID:     "node-persisted",
		Source:     "station.gate_runner",
		Status:     "active",
		PlanJSON:   string(planJSON),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if createErr := db.Create(&record).Error; createErr != nil {
		t.Fatalf("create gate plan: %v", createErr)
	}

	var loaded persistence.TaskGatePlan
	if loadErr := db.First(&loaded, "gate_plan_id = ?", record.GatePlanID).Error; loadErr != nil {
		t.Fatalf("load gate plan: %v", loadErr)
	}
	plan, err := GatePlanFromPersistence(loaded)
	if err != nil {
		t.Fatalf("convert gate plan: %v", err)
	}
	if plan.GetGatePlanId() != record.GatePlanID || plan.GetGates()[0].GetBlockingLevel() != model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK {
		t.Fatalf("unexpected persisted gate plan: %+v", plan)
	}
}

func TestGateRunnerRunAndAppendTxPersistsGateResult(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "gate_runner_append")
	now := time.Now()
	task := persistence.CollaborationTask{
		ID:            "task-gate-runner",
		Title:         "gate runner",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-gate-runner",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	initialEval := false
	if err := db.Create(&persistence.AcceptancePredicate{
		PredicateID: "predicate-gate-contract",
		TaskID:      task.ID,
		Scope:       "project",
		Level:       "L1",
		Evaluator:   "verifier",
		Expr:        "gate-contract.passed",
		LastEval:    &initialEval,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed acceptance predicate: %v", err)
	}

	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, decision, err := NewGateRunner(nil).RunAndAppendTx(
			context.Background(),
			tx,
			writer,
			node.AgentID,
			GateRunRequest{
				Task:        &task,
				Node:        &node,
				ProducedBy:  "station.gate_runner",
				GateID:      "gate-contract",
				Name:        "Contract Gate",
				Blocking:    true,
				ArtifactIDs: []string{"artifact-contract"},
				Checks: []GateCheck{{
					Name:   "contract",
					Type:   "passed",
					Detail: "projection contract passed",
				}},
			},
		)
		if err != nil {
			return err
		}
		if decision.Blocked {
			t.Fatalf("expected passing gate to be non-blocking, got %+v", decision)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("append gate runner result: %v", err)
	}

	var records []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&records).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected one gate event, got %+v", records)
	}
	if got := model.TaskEventType(records[0].EventType); got != model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT {
		t.Fatalf("expected TASK_EVENT_TYPE_GATE_RESULT, got %v", got)
	}
	var predicate persistence.AcceptancePredicate
	if err := db.First(&predicate, "predicate_id = ?", "predicate-gate-contract").Error; err != nil {
		t.Fatalf("load acceptance predicate: %v", err)
	}
	if predicate.LastEval == nil || !*predicate.LastEval {
		t.Fatalf("expected gate runner to refresh acceptance predicate, got %+v", predicate)
	}
	var projectState persistence.ProjectState
	if err := db.First(&projectState, "project_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load runtime project state: %v", err)
	}
	if projectState.ProjectState != "verifying" || projectState.MilestoneState != "accepted" {
		t.Fatalf("expected gate append to advance ProjectStateMachine, got %+v", projectState)
	}
}
