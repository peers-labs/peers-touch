package service

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestGoalAdmissionAndStartCreateOneCanonicalTaskRun(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-admission-1" }
	admission := NewGoalAdmissionService(goals)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")

	admitRequest := &model.AdmitAgentGoalRequest{
		GoalId:           reviewed.GetGoalId(),
		ExpectedRevision: reviewed.GetRevision(),
		IdempotencyKey:   "goal-admit-1",
	}
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		admitRequest,
	)
	if err != nil {
		t.Fatalf("admit Goal: %v", err)
	}
	if ready.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_READY ||
		ready.GetRevision() != reviewed.GetRevision()+1 {
		t.Fatalf("admitted Goal = %+v", ready)
	}
	replayedReady, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		admitRequest,
	)
	if err != nil {
		t.Fatalf("replay Goal admission: %v", err)
	}
	if replayedReady.GetRevision() != ready.GetRevision() ||
		replayedReady.GetStatus() != ready.GetStatus() {
		t.Fatalf("replayed admission = %+v, want %+v", replayedReady, ready)
	}

	startRequest := &model.StartAgentGoalRequest{
		GoalId:           ready.GetGoalId(),
		ExpectedRevision: ready.GetRevision(),
		IdempotencyKey:   "goal-start-1",
	}
	running, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		startRequest,
	)
	if err != nil {
		t.Fatalf("start Goal: %v", err)
	}
	if running.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING ||
		running.GetRevision() != ready.GetRevision()+1 {
		t.Fatalf("started Goal = %+v", running)
	}
	replayedRunning, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		startRequest,
	)
	if err != nil {
		t.Fatalf("replay Goal start: %v", err)
	}
	if replayedRunning.GetRevision() != running.GetRevision() ||
		replayedRunning.GetStatus() != running.GetStatus() {
		t.Fatalf("replayed start = %+v, want %+v", replayedRunning, running)
	}

	var taskRuns int64
	if err := db.Model(&persistence.TaskRun{}).Count(&taskRuns).Error; err != nil {
		t.Fatalf("count TaskRuns: %v", err)
	}
	if taskRuns != 1 {
		t.Fatalf("Goal admission/start wrote %d TaskRuns, want 1", taskRuns)
	}
	var goalNodes int64
	if err := db.Model(&persistence.AgentGoalNode{}).Count(&goalNodes).Error; err != nil {
		t.Fatalf("count Goal nodes: %v", err)
	}
	if goalNodes != 1 {
		t.Fatalf("Goal start wrote %d Goal nodes, want 1", goalNodes)
	}
	var steps int64
	if err := db.Model(&persistence.ExecutionStep{}).Count(&steps).Error; err != nil {
		t.Fatalf("count ExecutionSteps: %v", err)
	}
	if steps != 1 {
		t.Fatalf("Goal start wrote %d ExecutionSteps, want 1", steps)
	}

	execution, err := admission.executions.GetForOwner(
		context.Background(),
		"ptid:actor-1",
		stableGoalExecutionID("task", running.GetGoalId()),
	)
	if err != nil {
		t.Fatalf("read Goal execution: %v", err)
	}
	if execution.Node.GoalID != running.GetGoalId() ||
		execution.Node.TaskID != execution.Task.TaskID ||
		execution.Task.GoalNodeID != execution.Node.NodeID ||
		execution.Task.RootStepID != execution.Step.StepID ||
		execution.Step.TaskID != execution.Task.TaskID ||
		execution.Step.Attempt != 1 ||
		execution.Step.AttemptID == "" {
		t.Fatalf("Goal execution identity mismatch: %+v", execution)
	}

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
			"Goal start wrote legacy tasks: AgentTask=%d CollaborationTask=%d",
			agentTasks,
			collaborationTasks,
		)
	}
}

func TestGoalAdmissionRejectsIncompleteReviewWithoutMutation(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-admission-incomplete" }
	admission := NewGoalAdmissionService(goals)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	if err := db.Model(&persistence.AgentGoal{}).
		Where("goal_id = ?", reviewed.GetGoalId()).
		Update("budget_json", []byte("{}")).Error; err != nil {
		t.Fatalf("corrupt reviewed Goal fixture: %v", err)
	}

	_, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-admit-incomplete",
		},
	)
	var biz *errcode.BizError
	if !errors.As(err, &biz) ||
		biz.Code != errcode.AgentGoalAdmissionRejected ||
		biz.Payload.GetDetails()["reason_code"] != "max_tokens_missing" {
		t.Fatalf("Goal admission error = %+v", err)
	}

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		reviewed.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read rejected Goal: %v", err)
	}
	if reopened.GetStatus() !=
		model.AgentGoalStatus_AGENT_GOAL_STATUS_REVIEWING ||
		reopened.GetRevision() != reviewed.GetRevision() {
		t.Fatalf("rejected Goal mutated: %+v", reopened)
	}

	var taskRuns int64
	if err := db.Model(&persistence.TaskRun{}).Count(&taskRuns).Error; err != nil {
		t.Fatalf("count TaskRuns: %v", err)
	}
	if taskRuns != 0 {
		t.Fatalf("rejected admission wrote %d TaskRuns, want 0", taskRuns)
	}
}

func TestGoalReviewRejectsIncompleteContractWhileItIsEditable(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-review-incomplete" }
	created, err := goals.CreateDraft(
		context.Background(),
		"ptid:actor-1",
		&model.CreateAgentGoalRequest{
			Title:          "Incomplete Goal",
			Outcome:        "Remain editable after review rejection",
			IdempotencyKey: "goal-create-review-incomplete",
		},
	)
	if err != nil {
		t.Fatalf("create incomplete Goal: %v", err)
	}

	_, err = goals.Review(
		context.Background(),
		"ptid:actor-1",
		&model.ReviewAgentGoalRequest{
			GoalId:           created.GetGoalId(),
			ExpectedRevision: created.GetRevision(),
			IdempotencyKey:   "goal-review-incomplete",
		},
	)
	var biz *errcode.BizError
	if !errors.As(err, &biz) ||
		biz.Code != errcode.AgentGoalAdmissionRejected ||
		biz.Payload.GetDetails()["reason_code"] != "max_tokens_missing" {
		t.Fatalf("Goal review error = %+v", err)
	}

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		created.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read rejected Goal review: %v", err)
	}
	if reopened.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT ||
		reopened.GetRevision() != created.GetRevision() {
		t.Fatalf("rejected review mutated Goal: %+v", reopened)
	}
}

func TestGoalStartRejectsNonReadyStaleAndForeignActor(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	goals.newID = func() string { return "goal-start-guards" }
	admission := NewGoalAdmissionService(goals)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")

	_, err := admission.Start(
		context.Background(),
		"ptid:actor-1",
		&model.StartAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-start-before-admission",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentInvalidSourceState)

	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-admit-guards",
		},
	)
	if err != nil {
		t.Fatalf("admit guarded Goal: %v", err)
	}

	_, err = admission.Start(
		context.Background(),
		"ptid:actor-1",
		&model.StartAgentGoalRequest{
			GoalId:           ready.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-start-stale",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentLifecycleStaleVersion)

	_, err = admission.Start(
		context.Background(),
		"ptid:actor-2",
		&model.StartAgentGoalRequest{
			GoalId:           ready.GetGoalId(),
			ExpectedRevision: ready.GetRevision(),
			IdempotencyKey:   "goal-start-foreign",
		},
	)
	assertGoalErrorCode(t, err, errcode.AgentOwnershipForbiddenActor)
}

func createReviewedGoal(
	t *testing.T,
	goals *GoalService,
	ownerPTID string,
) *model.AgentGoal {
	t.Helper()
	created, err := goals.CreateDraft(
		context.Background(),
		ownerPTID,
		&model.CreateAgentGoalRequest{
			Title:          "Admitted Goal",
			Outcome:        "Start one reviewed durable Goal",
			IdempotencyKey: "goal-create-admission",
		},
	)
	if err != nil {
		t.Fatalf("create Goal: %v", err)
	}
	updated, err := goals.UpdateContract(
		context.Background(),
		ownerPTID,
		&model.UpdateAgentGoalRequest{
			GoalId:      created.GetGoalId(),
			Outcome:     created.GetOutcome(),
			NonGoals:    []string{"Do not create a TaskRun yet"},
			Constraints: []string{"Keep Station as lifecycle owner"},
			Budget: &model.AgentGoalBudget{
				MaxTokens:        100_000,
				WallTimeMs:       3_600_000,
				MaxParallelTasks: 2,
			},
			AcceptanceCriteria: []*model.AgentGoalAcceptanceCriterion{{
				CriterionId: "criterion-1",
				Description: "Station readback is RUNNING",
				Evaluator:   "deterministic",
				Required:    true,
			}},
			ExpectedRevision: created.GetRevision(),
			IdempotencyKey:   "goal-update-admission",
		},
	)
	if err != nil {
		t.Fatalf("update Goal: %v", err)
	}
	reviewed, err := goals.Review(
		context.Background(),
		ownerPTID,
		&model.ReviewAgentGoalRequest{
			GoalId:           updated.GetGoalId(),
			ExpectedRevision: updated.GetRevision(),
			IdempotencyKey:   "goal-review-admission",
		},
	)
	if err != nil {
		t.Fatalf("review Goal: %v", err)
	}
	return reviewed
}
