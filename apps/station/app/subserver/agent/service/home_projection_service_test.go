package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type homeAgentListerStub struct {
	agents []domain.Agent
	err    error
}

func (s homeAgentListerStub) ListAgents(
	context.Context,
	domain.AgentListOptions,
) ([]domain.Agent, int64, error) {
	return s.agents, int64(len(s.agents)), s.err
}

type homeConversationListerStub struct {
	byAgent map[string][]*domain.Conversation
	errors  map[string]error
}

type homeReadinessGetterStub struct {
	byAgent map[string]*model.CapabilityReadinessSnapshot
	errors  map[string]error
}

func (s homeReadinessGetterStub) Get(
	_ context.Context,
	_ string,
	req *model.GetCapabilityReadinessRequest,
) (*model.CapabilityReadinessSnapshot, error) {
	if err := s.errors[req.GetAgentId()]; err != nil {
		return nil, err
	}
	return s.byAgent[req.GetAgentId()], nil
}

type homeTaskListerStub struct {
	tasks []*persistence.AgentTask
	err   error
}

type homeMigratingTaskListerStub struct {
	homeTaskListerStub
	migrations []persistence.AgentTaskGoalMap
	migrateErr error
}

func (s homeMigratingTaskListerStub) ListTaskMigrationReadbacks(
	context.Context,
	string,
) ([]persistence.AgentTaskGoalMap, error) {
	return s.migrations, s.migrateErr
}

type homeGoalExecutionListerStub struct {
	executions []*GoalExecutionSnapshot
	err        error
}

func (s homeGoalExecutionListerStub) ListForOwner(
	context.Context,
	string,
	int,
) ([]*GoalExecutionSnapshot, error) {
	return s.executions, s.err
}

func (s homeTaskListerStub) ListTasks(
	context.Context,
	string,
	string,
) ([]*persistence.AgentTask, error) {
	return s.tasks, s.err
}

func (s homeConversationListerStub) ListConversations(
	_ context.Context,
	agentID string,
	_ string,
	_ string,
	_ int,
	_ int,
) ([]*domain.Conversation, int64, error) {
	if err := s.errors[agentID]; err != nil {
		return nil, 0, err
	}
	conversations := s.byAgent[agentID]
	return conversations, int64(len(conversations)), nil
}

func TestHomeProjectionUsesStationAgentsAndRecentConversations(t *testing.T) {
	older := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Hour)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{
			{
				AgentID:    "agent-1",
				Name:       "researcher",
				Title:      "Researcher",
				ConfigJSON: `{"pinned":true,"avatar":"avatar://researcher"}`,
				UpdatedAt:  older,
			},
			{
				AgentID:    "agent-2",
				Name:       "writer",
				Title:      "Writer",
				ConfigJSON: `{"pinned":false}`,
				UpdatedAt:  newer,
			},
		}},
		homeConversationListerStub{byAgent: map[string][]*domain.Conversation{
			"agent-1": {
				{
					ConversationID: "conversation-old",
					AgentID:        "agent-1",
					Title:          "Older",
					UpdatedAt:      older,
				},
			},
			"agent-2": {
				{
					ConversationID: "conversation-new",
					AgentID:        "agent-2",
					Title:          "Newer",
					UpdatedAt:      newer,
				},
			},
		}},
		nil,
		nil,
	)
	svc.now = func() time.Time { return newer.Add(time.Minute) }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetPtid() != "ptid:actor-1" {
		t.Fatalf("ptid = %q", projection.GetPtid())
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_FRESH {
		t.Fatalf("freshness = %s", projection.GetFreshness())
	}
	if len(projection.GetPinnedAgents()) != 1 ||
		projection.GetPinnedAgents()[0].GetAgentId() != "agent-1" ||
		projection.GetPinnedAgents()[0].GetAgentName() != "researcher" {
		t.Fatalf("pinned agents = %+v", projection.GetPinnedAgents())
	}
	if len(projection.GetRecentWork()) != 2 ||
		projection.GetRecentWork()[0].GetWorkId() != "conversation-new" {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
	if projection.GetRevision() != uint64(newer.UnixNano()) {
		t.Fatalf("revision = %d, want %d", projection.GetRevision(), newer.UnixNano())
	}
}

func TestHomeProjectionIncludesCanonicalGoalDirectModelResult(t *testing.T) {
	now := time.Date(2026, 10, 4, 13, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{},
		homeConversationListerStub{},
		nil,
		nil,
		homeGoalExecutionListerStub{executions: []*GoalExecutionSnapshot{{
			Node: &persistence.AgentGoalNode{
				GoalID: "goal-result",
				NodeID: "node-result",
				TaskID: "task-result",
				Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			},
			Task: &persistence.TaskRun{
				TaskID:         "task-result",
				Title:          "Prepare visible result",
				Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
				Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
				OwnerActorPTID: "ptid:actor-1",
				GoalID:         "goal-result",
				GoalNodeID:     "node-result",
				RootStepID:     "step-result",
				UpdatedAt:      now,
			},
			Step: &persistence.ExecutionStep{
				StepID:        "step-result",
				TaskID:        "task-result",
				AgentID:       "agent-result",
				Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
				Attempt:       1,
				AttemptID:     "attempt-result",
				ResultSummary: "Durable model result",
			},
			Result: &GoalResultProjection{
				DirectRunID: "direct-result",
				State:       "succeeded",
				Summary:     "Durable model result",
				ArtifactID:  "artifact-result",
			},
		}}},
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if len(projection.GetActiveTasks()) != 1 ||
		projection.GetActiveTasks()[0].GetStatus() !=
			model.HomeTaskStatus_HOME_TASK_STATUS_COMPLETED {
		t.Fatalf("terminal canonical TaskRun = %+v", projection.GetActiveTasks())
	}
	if len(projection.GetBriefItems()) != 1 ||
		projection.GetBriefItems()[0].GetBriefId() !=
			"goal-result:artifact-result" ||
		projection.GetBriefItems()[0].GetSourceRef() != "task-result" ||
		projection.GetBriefItems()[0].GetSummary() != "Durable model result" {
		t.Fatalf("Goal result brief = %+v", projection.GetBriefItems())
	}
}

func TestHomeProjectionIgnoresUnpinnedAgentReadinessFailure(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{
			{
				AgentID:    "agent-pinned",
				Name:       "ready",
				ProviderID: "provider-1",
				ModelName:  "model-1",
				ConfigJSON: `{"pinned":true}`,
				UpdatedAt:  now,
			},
			{
				AgentID:    "agent-unpinned",
				Name:       "unconfigured",
				ConfigJSON: `{"pinned":false}`,
				UpdatedAt:  now,
			},
		}},
		homeConversationListerStub{},
		homeReadinessGetterStub{
			byAgent: map[string]*model.CapabilityReadinessSnapshot{
				"agent-pinned": {
					SnapshotId:        "readiness-pinned",
					AgentId:           "agent-pinned",
					RuntimeSnapshotId: "runtime-pinned",
					CreatedAt:         timestamppb.New(now),
				},
			},
			errors: map[string]error{
				"agent-unpinned": errors.New("provider is not configured"),
			},
		},
		nil,
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_FRESH {
		t.Fatalf("freshness = %s, want fresh", projection.GetFreshness())
	}
	if len(projection.GetPinnedAgents()) != 1 ||
		projection.GetPinnedAgents()[0].GetAgentId() != "agent-pinned" {
		t.Fatalf("pinned agents = %+v", projection.GetPinnedAgents())
	}
	if len(projection.GetReadiness()) != 1 ||
		projection.GetReadiness()[0].GetAgentId() != "agent-pinned" {
		t.Fatalf("readiness = %+v", projection.GetReadiness())
	}
	if len(projection.GetSliceErrors()) != 0 {
		t.Fatalf("slice errors = %+v, want none", projection.GetSliceErrors())
	}
}

func TestHomeProjectionPreservesValidSlicesWhenOneConversationSourceFails(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{
			{AgentID: "agent-1", Name: "one", UpdatedAt: now},
			{AgentID: "agent-2", Name: "two", UpdatedAt: now},
		}},
		homeConversationListerStub{
			byAgent: map[string][]*domain.Conversation{
				"agent-1": {
					{
						ConversationID: "conversation-1",
						AgentID:        "agent-1",
						Title:          "Available",
						UpdatedAt:      now,
					},
				},
			},
			errors: map[string]error{"agent-2": errors.New("source unavailable")},
		},
		nil,
		nil,
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_PARTIAL {
		t.Fatalf("freshness = %s", projection.GetFreshness())
	}
	if len(projection.GetRecentWork()) != 1 {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
	if len(projection.GetSliceErrors()) != 1 ||
		projection.GetSliceErrors()[0].GetSliceId() != "recent_work:agent-2" ||
		!projection.GetSliceErrors()[0].GetRetryable() {
		t.Fatalf("slice errors = %+v", projection.GetSliceErrors())
	}
}

func TestHomeProjectionRejectsMissingActor(t *testing.T) {
	svc := NewHomeProjectionService(
		homeAgentListerStub{},
		homeConversationListerStub{},
		nil,
		nil,
	)

	if _, err := svc.Get(context.Background(), " ", 0); err == nil {
		t.Fatal("Get() error = nil, want actor validation error")
	}
}

func TestHomeProjectionMarksOlderAuthoritativeRevisionStale(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	authoritativeRevision := uint64(now.UnixNano())
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{{
			AgentID:   "agent-1",
			Name:      "researcher",
			UpdatedAt: now,
		}}},
		homeConversationListerStub{},
		nil,
		nil,
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(
		context.Background(),
		"ptid:actor-1",
		authoritativeRevision+1,
	)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetRevision() != authoritativeRevision {
		t.Fatalf(
			"revision = %d, want authoritative revision %d",
			projection.GetRevision(),
			authoritativeRevision,
		)
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_STALE {
		t.Fatalf("freshness = %s, want stale", projection.GetFreshness())
	}
	if len(projection.GetSliceErrors()) != 1 {
		t.Fatalf("slice errors = %+v, want one", projection.GetSliceErrors())
	}
	staleError := projection.GetSliceErrors()[0]
	if staleError.GetSliceId() != "projection" ||
		staleError.GetCode() != model.HomeErrorCode_HOME_ERROR_CODE_PROJECTION_STALE ||
		!staleError.GetRetryable() ||
		staleError.GetRecoveryAction() != "retry" {
		t.Fatalf("stale error = %+v", staleError)
	}
}

func TestHomeProjectionIncludesReadinessAndTaskSlices(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{{
			AgentID:    "agent-1",
			Name:       "researcher",
			Title:      "Researcher",
			ProviderID: "provider-1",
			ModelName:  "model-1",
			ConfigJSON: `{"pinned":true}`,
			Version:    3,
			UpdatedAt:  now,
		}}},
		homeConversationListerStub{},
		homeReadinessGetterStub{byAgent: map[string]*model.CapabilityReadinessSnapshot{
			"agent-1": {
				SnapshotId:        "readiness-1",
				AgentId:           "agent-1",
				RuntimeSnapshotId: "runtime-1",
				CreatedAt:         timestamppb.New(now),
				Capabilities: []*model.CapabilityReadiness{{
					CapabilityId:      "tool.search",
					CapabilityVersion: "1",
					State:             model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
				}},
			},
		}},
		homeTaskListerStub{tasks: []*persistence.AgentTask{{
			ID:           "task-1",
			Title:        "Prepare brief",
			AgentID:      "agent-1",
			Status:       "running",
			Progress:     25,
			OwnerActorID: "ptid:actor-1",
			UpdatedAt:    now,
		}}},
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetPinnedAgents()[0].GetReadinessSnapshotId() != "readiness-1" ||
		projection.GetPinnedAgents()[0].GetAgentVersion() != 3 {
		t.Fatalf("pinned Agent = %+v", projection.GetPinnedAgents()[0])
	}
	if len(projection.GetActiveTasks()) != 1 ||
		projection.GetActiveTasks()[0].GetTaskId() != "task-1" {
		t.Fatalf("active tasks = %+v", projection.GetActiveTasks())
	}
	if len(projection.GetRecentWork()) != 1 ||
		projection.GetRecentWork()[0].GetKind() != model.HomeWorkKind_HOME_WORK_KIND_TASK {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
	if len(projection.GetCapabilitySummaries()) != 1 ||
		projection.GetCapabilitySummaries()[0].GetReadinessState() != "ready" {
		t.Fatalf("capability summaries = %+v", projection.GetCapabilitySummaries())
	}
}

func TestHomeProjectionIncludesCanonicalGoalTaskRun(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{},
		homeConversationListerStub{},
		nil,
		nil,
		homeGoalExecutionListerStub{executions: []*GoalExecutionSnapshot{{
			Node: &persistence.AgentGoalNode{
				GoalID: "goal-1",
				NodeID: "node-1",
				TaskID: "task-1",
				Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			},
			Task: &persistence.TaskRun{
				TaskID:         "task-1",
				Title:          "Prepare durable result",
				Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
				Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING),
				OwnerActorPTID: "ptid:actor-1",
				WorkspaceID:    "workspace-1",
				GoalID:         "goal-1",
				GoalNodeID:     "node-1",
				RootStepID:     "step-1",
				UpdatedAt:      now,
			},
			Step: &persistence.ExecutionStep{
				StepID:    "step-1",
				TaskID:    "task-1",
				AgentID:   "agent-1",
				Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
				Attempt:   1,
				AttemptID: "attempt-1",
			},
		}}},
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if len(projection.GetActiveTasks()) != 1 {
		t.Fatalf("active tasks = %+v", projection.GetActiveTasks())
	}
	task := projection.GetActiveTasks()[0]
	if task.GetTaskId() != "task-1" ||
		task.GetGoalId() != "goal-1" ||
		task.GetGoalNodeId() != "node-1" ||
		task.GetStepId() != "step-1" ||
		task.GetAttemptId() != "attempt-1" ||
		task.GetAttempt() != 1 ||
		task.GetSurface() != model.TaskSurface_TASK_SURFACE_DIRECT_RUN {
		t.Fatalf("canonical Goal TaskRun = %+v", task)
	}
	if len(projection.GetRecentWork()) != 1 ||
		projection.GetRecentWork()[0].GetWorkId() != "task-1" {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
}

func TestHomeProjectionShowsMigratedAgentTaskThroughCanonicalIdentity(t *testing.T) {
	now := time.Date(2026, 10, 4, 14, 0, 0, 0, time.UTC)
	legacy := &persistence.AgentTask{
		ID:           "legacy-task-1",
		Title:        "Migrated task",
		AgentID:      "agent-1",
		Status:       "running",
		OwnerActorID: "ptid:actor-1",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	migration := persistence.AgentTaskGoalMap{
		LegacyTaskID:    legacy.ID,
		OwnerPTID:       legacy.OwnerActorID,
		GoalID:          "goal-migrated",
		TaskID:          "task-migrated",
		GoalNodeID:      "node-migrated",
		StepID:          "step-migrated",
		AttemptID:       "attempt-migrated",
		State:           persistence.AgentTaskMigrationStateMigrated,
		SourceStatus:    legacy.Status,
		SourceUpdatedAt: now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	svc := NewHomeProjectionService(
		homeAgentListerStub{},
		homeConversationListerStub{},
		nil,
		homeMigratingTaskListerStub{
			homeTaskListerStub: homeTaskListerStub{
				tasks: []*persistence.AgentTask{legacy},
			},
			migrations: []persistence.AgentTaskGoalMap{migration},
		},
		homeGoalExecutionListerStub{executions: []*GoalExecutionSnapshot{{
			Node: &persistence.AgentGoalNode{
				GoalID: migration.GoalID,
				NodeID: migration.GoalNodeID,
				TaskID: migration.TaskID,
				Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			},
			Task: &persistence.TaskRun{
				TaskID:         migration.TaskID,
				Title:          legacy.Title,
				Surface:        int32(model.TaskSurface_TASK_SURFACE_API),
				Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
				OwnerActorPTID: legacy.OwnerActorID,
				GoalID:         migration.GoalID,
				GoalNodeID:     migration.GoalNodeID,
				RootStepID:     migration.StepID,
				CreatedAt:      now,
				UpdatedAt:      now,
			},
			Step: &persistence.ExecutionStep{
				StepID:    migration.StepID,
				TaskID:    migration.TaskID,
				AgentID:   legacy.AgentID,
				Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				Attempt:   1,
				AttemptID: migration.AttemptID,
			},
		}}},
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), legacy.OwnerActorID, 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if len(projection.GetActiveTasks()) != 1 {
		t.Fatalf("active tasks = %+v", projection.GetActiveTasks())
	}
	task := projection.GetActiveTasks()[0]
	if task.GetTaskId() != migration.TaskID ||
		task.GetGoalId() != migration.GoalID ||
		task.GetLegacySourceId() != legacy.ID ||
		task.GetMigrationState() !=
			model.HomeTaskMigrationState_HOME_TASK_MIGRATION_STATE_MIGRATED {
		t.Fatalf("migrated Home task = %+v", task)
	}
	if len(projection.GetRecentWork()) != 1 ||
		projection.GetRecentWork()[0].GetWorkId() != migration.TaskID {
		t.Fatalf("migrated recent work = %+v", projection.GetRecentWork())
	}
}

func TestHomeProjectionShowsBlockedAgentTaskMigration(t *testing.T) {
	now := time.Date(2026, 10, 4, 14, 30, 0, 0, time.UTC)
	legacy := &persistence.AgentTask{
		ID:           "legacy-task-blocked",
		Title:        "Ambiguous task",
		AgentID:      "agent-1",
		Status:       "completed",
		Progress:     99,
		OwnerActorID: "ptid:actor-1",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	migration := persistence.AgentTaskGoalMap{
		LegacyTaskID:    legacy.ID,
		OwnerPTID:       legacy.OwnerActorID,
		GoalID:          "goal-blocked",
		TaskID:          "task-blocked",
		GoalNodeID:      "node-blocked",
		StepID:          "step-blocked",
		AttemptID:       "attempt-blocked",
		State:           persistence.AgentTaskMigrationStateBlocked,
		BlockReason:     "terminal_state_ambiguous",
		SourceStatus:    legacy.Status,
		SourceUpdatedAt: now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	svc := NewHomeProjectionService(
		homeAgentListerStub{},
		homeConversationListerStub{},
		nil,
		homeMigratingTaskListerStub{
			homeTaskListerStub: homeTaskListerStub{
				tasks: []*persistence.AgentTask{legacy},
			},
			migrations: []persistence.AgentTaskGoalMap{migration},
		},
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), legacy.OwnerActorID, 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if len(projection.GetActiveTasks()) != 1 {
		t.Fatalf("active tasks = %+v", projection.GetActiveTasks())
	}
	task := projection.GetActiveTasks()[0]
	if task.GetStatus() != model.HomeTaskStatus_HOME_TASK_STATUS_NEEDS_USER ||
		task.GetMigrationState() !=
			model.HomeTaskMigrationState_HOME_TASK_MIGRATION_STATE_BLOCKED ||
		task.GetMigrationBlockReason() != "terminal_state_ambiguous" {
		t.Fatalf("blocked Home task = %+v", task)
	}
}
