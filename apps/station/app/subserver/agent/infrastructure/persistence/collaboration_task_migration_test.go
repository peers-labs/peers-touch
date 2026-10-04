package persistence

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCollaborationTaskMigrationIsStableAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "collaboration-task-migration.db")
	db := openCollaborationTaskMigrationTestDB(t, path)
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	source := CollaborationTask{
		ID:            "collab-legacy-1",
		Title:         "Reopen Atelier work",
		Description:   "Preserve the collaboration project.",
		EngineType:    int32(model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY),
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "ptid:actor-1",
		WorkspaceID:   "workspace-1",
		MetaJSON:      `{"project":"peers-touch","project_id":"legacy-project-label"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []CollaborationTaskNode{
		{
			ID:            "legacy-node-plan",
			TaskID:        source.ID,
			AgentID:       "agent-planner",
			Role:          "planner",
			Description:   "Plan the migration.",
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			StartedAt:     now,
			EndedAt:       now.Add(time.Minute),
			ResultSummary: "Plan complete.",
		},
		{
			ID:                  "legacy-node-execute",
			TaskID:              source.ID,
			AgentID:             "agent-executor",
			Role:                "executor",
			Description:         "Execute the migration.",
			Status:              int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			PrerequisiteNodeIDs: `["legacy-node-plan"]`,
			StartedAt:           now.Add(time.Minute),
			EndedAt:             now.Add(time.Minute),
		},
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatalf("seed legacy CollaborationTask: %v", err)
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatalf("seed legacy CollaborationTask nodes: %v", err)
	}

	if err := MigrateCollaborationTasks(db); err != nil {
		t.Fatalf("first CollaborationTask migration: %v", err)
	}
	first := readCollaborationTaskMigrationMap(t, db, source.ID)
	closeCollaborationTaskMigrationTestDB(t, db)

	restarted := openCollaborationTaskMigrationTestDB(t, path)
	if err := MigrateCollaborationTasks(restarted); err != nil {
		t.Fatalf("restarted CollaborationTask migration: %v", err)
	}
	second := readCollaborationTaskMigrationMap(t, restarted, source.ID)
	if first.GoalID != second.GoalID ||
		first.TaskID != second.TaskID ||
		first.GoalNodeID != second.GoalNodeID ||
		first.RootStepID != second.RootStepID ||
		first.RootAttemptID != second.RootAttemptID {
		t.Fatalf("migration identities changed: first=%+v second=%+v", first, second)
	}
	if second.State != CollaborationTaskMigrationStateMigrated || second.BlockReason != "" {
		t.Fatalf("migration state = %+v", second)
	}
	if second.TaskID != source.ID {
		t.Fatalf("legacy task/event key changed: got %q want %q", second.TaskID, source.ID)
	}

	assertCollaborationTaskMigrationCount(t, restarted, &CollaborationTask{}, 1)
	assertCollaborationTaskMigrationCount(t, restarted, &CollaborationTaskNode{}, 2)
	assertCollaborationTaskMigrationCount(t, restarted, &CollaborationTaskGoalMap{}, 1)
	assertCollaborationTaskMigrationCount(t, restarted, &AgentGoal{}, 1)
	assertCollaborationTaskMigrationCount(t, restarted, &AgentGoalNode{}, 1)
	assertCollaborationTaskMigrationCount(t, restarted, &TaskRun{}, 1)
	assertCollaborationTaskMigrationCount(t, restarted, &ExecutionStep{}, 2)

	var goal AgentGoal
	if err := restarted.First(&goal, "goal_id = ?", second.GoalID).Error; err != nil {
		t.Fatalf("read migrated Goal: %v", err)
	}
	if goal.OwnerPTID != source.GoalOwnerPTID ||
		goal.Status != int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING) {
		t.Fatalf("migrated Goal = %+v", goal)
	}
	var task TaskRun
	if err := restarted.First(&task, "task_id = ?", second.TaskID).Error; err != nil {
		t.Fatalf("read migrated TaskRun: %v", err)
	}
	if task.GoalID != second.GoalID ||
		task.GoalNodeID != second.GoalNodeID ||
		task.RootStepID != second.RootStepID ||
		task.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING) {
		t.Fatalf("migrated TaskRun = %+v", task)
	}
}

func TestCollaborationTaskMigrationPreservesExistingTaskRunIdentity(t *testing.T) {
	db := openCollaborationTaskMigrationTestDB(
		t,
		filepath.Join(t.TempDir(), "collaboration-task-existing-run.db"),
	)
	now := time.Date(2026, 10, 4, 13, 0, 0, 0, time.UTC)
	source := CollaborationTask{
		ID:            "collab-direct-run",
		Title:         "Existing direct run",
		Description:   "Keep the existing runtime identifiers.",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "ptid:actor-1",
		MetaJSON:      `{"project":"peers-touch"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	task := TaskRun{
		TaskID:         source.ID,
		Title:          source.Title,
		Description:    source.Description,
		Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		Status:         source.Status,
		OwnerActorPTID: source.GoalOwnerPTID,
		MetaJSON:       `{"direct_run_id":"direct-run-1"}`,
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
	}
	step := ExecutionStep{
		StepID:    "direct-run-step-1",
		TaskID:    source.ID,
		AgentID:   "provider-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		Attempt:   1,
		AttemptID: "direct-run-attempt-1",
		StartedAt: now,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatalf("seed legacy CollaborationTask: %v", err)
	}
	if err := db.AutoMigrate(&TaskRun{}, &ExecutionStep{}); err != nil {
		t.Fatalf("migrate existing canonical runtime schema: %v", err)
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("seed existing TaskRun: %v", err)
	}
	if err := db.Create(&step).Error; err != nil {
		t.Fatalf("seed existing ExecutionStep: %v", err)
	}

	if err := MigrateCollaborationTasks(db); err != nil {
		t.Fatalf("migrate CollaborationTask with existing TaskRun: %v", err)
	}
	mapping := readCollaborationTaskMigrationMap(t, db, source.ID)
	if mapping.TaskID != task.TaskID ||
		mapping.RootStepID != step.StepID ||
		mapping.RootAttemptID != step.AttemptID {
		t.Fatalf("existing runtime identities were replaced: %+v", mapping)
	}
	var migrated TaskRun
	if err := db.First(&migrated, "task_id = ?", task.TaskID).Error; err != nil {
		t.Fatalf("read existing TaskRun after migration: %v", err)
	}
	if migrated.Surface != task.Surface ||
		migrated.GoalID != mapping.GoalID ||
		migrated.GoalNodeID != mapping.GoalNodeID ||
		migrated.RootStepID != step.StepID {
		t.Fatalf("unexpected migrated existing TaskRun: %+v", migrated)
	}
}

func TestCollaborationTaskMigrationBlocksAmbiguousMetadataAndPreservesSource(t *testing.T) {
	db := openCollaborationTaskMigrationTestDB(
		t,
		filepath.Join(t.TempDir(), "collaboration-task-blocked.db"),
	)
	now := time.Date(2026, 10, 4, 14, 0, 0, 0, time.UTC)
	source := CollaborationTask{
		ID:            "collab-ambiguous",
		Title:         "Ambiguous identity",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "ptid:actor-1",
		MetaJSON:      `{"goal_id":"goal-one","project_id":"goal-two"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatalf("seed ambiguous CollaborationTask: %v", err)
	}

	if err := MigrateCollaborationTasks(db); err != nil {
		t.Fatalf("migrate ambiguous CollaborationTask: %v", err)
	}
	mapping := readCollaborationTaskMigrationMap(t, db, source.ID)
	if mapping.State != CollaborationTaskMigrationStateBlocked ||
		mapping.BlockReason != "identity_metadata_ambiguous" {
		t.Fatalf("ambiguous migration = %+v", mapping)
	}
	assertCollaborationTaskMigrationCount(t, db, &CollaborationTask{}, 1)
	assertCollaborationTaskMigrationCount(t, db, &CollaborationTaskGoalMap{}, 1)
	assertCollaborationTaskMigrationCount(t, db, &AgentGoal{}, 0)
	assertCollaborationTaskMigrationCount(t, db, &TaskRun{}, 0)
}

func openCollaborationTaskMigrationTestDB(t *testing.T, path string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatalf("open CollaborationTask migration database: %v", err)
	}
	if err := db.AutoMigrate(&CollaborationTask{}, &CollaborationTaskNode{}); err != nil {
		t.Fatalf("migrate legacy CollaborationTask schema: %v", err)
	}
	return db
}

func closeCollaborationTaskMigrationTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open CollaborationTask migration sql database: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close CollaborationTask migration database: %v", err)
	}
}

func readCollaborationTaskMigrationMap(
	t *testing.T,
	db *gorm.DB,
	legacyTaskID string,
) CollaborationTaskGoalMap {
	t.Helper()
	var row CollaborationTaskGoalMap
	if err := db.First(&row, "legacy_task_id = ?", legacyTaskID).Error; err != nil {
		t.Fatalf("read CollaborationTask migration map: %v", err)
	}
	return row
}

func assertCollaborationTaskMigrationCount(
	t *testing.T,
	db *gorm.DB,
	modelValue any,
	want int64,
) {
	t.Helper()
	var got int64
	if err := db.Model(modelValue).Count(&got).Error; err != nil {
		t.Fatalf("count %T: %v", modelValue, err)
	}
	if got != want {
		t.Fatalf("%T count = %d, want %d", modelValue, got, want)
	}
}
