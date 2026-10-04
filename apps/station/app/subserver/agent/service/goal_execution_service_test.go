package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestGoalTaskRunAllocationFailureLeavesGoalReady(t *testing.T) {
	db := openGoalServiceTestDB(t)
	goals := NewGoalService(db)
	admission := NewGoalAdmissionService(goals)
	reviewed := createReviewedGoal(t, goals, "ptid:actor-1")
	ready, err := admission.Admit(
		context.Background(),
		"ptid:actor-1",
		&model.AdmitAgentGoalRequest{
			GoalId:           reviewed.GetGoalId(),
			ExpectedRevision: reviewed.GetRevision(),
			IdempotencyKey:   "goal-taskrun-rollback-admit",
		},
	)
	if err != nil {
		t.Fatalf("admit Goal: %v", err)
	}
	if err := db.Migrator().DropTable(&persistence.ExecutionStep{}); err != nil {
		t.Fatalf("drop ExecutionStep table: %v", err)
	}

	_, err = admission.Start(
		context.Background(),
		"ptid:actor-1",
		&model.StartAgentGoalRequest{
			GoalId:           ready.GetGoalId(),
			ExpectedRevision: ready.GetRevision(),
			IdempotencyKey:   "goal-taskrun-rollback-start",
		},
	)
	if err == nil {
		t.Fatal("start Goal error = nil, want allocation failure")
	}

	reopened, err := goals.Get(
		context.Background(),
		"ptid:actor-1",
		ready.GetGoalId(),
	)
	if err != nil {
		t.Fatalf("read Goal after failed allocation: %v", err)
	}
	if reopened.GetStatus() != model.AgentGoalStatus_AGENT_GOAL_STATUS_READY ||
		reopened.GetRevision() != ready.GetRevision() ||
		reopened.GetGraphRevision() != ready.GetGraphRevision() {
		t.Fatalf("Goal mutated after failed allocation: %+v", reopened)
	}

	var taskRuns int64
	if err := db.Model(&persistence.TaskRun{}).Count(&taskRuns).Error; err != nil {
		t.Fatalf("count TaskRuns: %v", err)
	}
	var goalNodes int64
	if err := db.Model(&persistence.AgentGoalNode{}).Count(&goalNodes).Error; err != nil {
		t.Fatalf("count Goal nodes: %v", err)
	}
	if taskRuns != 0 || goalNodes != 0 {
		t.Fatalf(
			"failed allocation committed partial records: TaskRun=%d GoalNode=%d",
			taskRuns,
			goalNodes,
		)
	}
}

func TestGoalTaskRunIdentityIsStableForGoal(t *testing.T) {
	goalID := "goal-stable-identity"
	if stableGoalExecutionID("task", goalID) !=
		stableGoalExecutionID("task", goalID) {
		t.Fatal("TaskRun identity is not stable")
	}
	if stableGoalExecutionID("task", goalID) ==
		stableGoalExecutionID("step", goalID) {
		t.Fatal("TaskRun and ExecutionStep identities collided")
	}
}

func TestGoalTaskRunAllocationStoresNonChatConversationAsNull(t *testing.T) {
	db := openGoalServiceTestDB(t)
	for _, ownerPTID := range []string{"ptid:actor-1", "ptid:actor-2"} {
		goals := NewGoalService(db)
		admission := NewGoalAdmissionService(goals)
		reviewed := createReviewedGoal(t, goals, ownerPTID)
		ready, err := admission.Admit(
			context.Background(),
			ownerPTID,
			&model.AdmitAgentGoalRequest{
				GoalId:           reviewed.GetGoalId(),
				ExpectedRevision: reviewed.GetRevision(),
				IdempotencyKey:   "goal-taskrun-null-admit",
			},
		)
		if err != nil {
			t.Fatalf("admit Goal for %s: %v", ownerPTID, err)
		}
		if _, err := admission.Start(
			context.Background(),
			ownerPTID,
			&model.StartAgentGoalRequest{
				GoalId:           ready.GetGoalId(),
				ExpectedRevision: ready.GetRevision(),
				IdempotencyKey:   "goal-taskrun-null-start",
			},
		); err != nil {
			t.Fatalf("start Goal for %s: %v", ownerPTID, err)
		}
	}

	var taskRuns int64
	if err := db.Model(&persistence.TaskRun{}).Count(&taskRuns).Error; err != nil {
		t.Fatalf("count TaskRuns: %v", err)
	}
	var nullConversations int64
	if err := db.Model(&persistence.TaskRun{}).
		Where("conversation_id IS NULL").
		Count(&nullConversations).Error; err != nil {
		t.Fatalf("count null TaskRun conversations: %v", err)
	}
	if taskRuns != 2 || nullConversations != 2 {
		t.Fatalf(
			"TaskRuns=%d null conversations=%d, want 2 and 2",
			taskRuns,
			nullConversations,
		)
	}
}
