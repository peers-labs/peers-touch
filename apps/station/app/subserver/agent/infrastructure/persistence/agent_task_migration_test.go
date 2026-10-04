package persistence

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAgentTaskMigrationIsStableAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-task-migration.db")
	db := openAgentTaskMigrationTestDB(t, path)
	now := time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC)
	source := AgentTask{
		ID:           "legacy-task-1",
		Title:        "Resume migrated work",
		Description:  "Preserve the original work description.",
		AgentID:      "agent-1",
		Status:       "running",
		Priority:     "high",
		Progress:     40,
		SubtasksJSON: "[]",
		OwnerActorID: "ptid:actor-1",
		CreatedAt:    now,
		UpdatedAt:    now.Add(time.Minute),
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatalf("seed legacy AgentTask: %v", err)
	}

	if err := MigrateAgentTasks(db); err != nil {
		t.Fatalf("first AgentTask migration: %v", err)
	}
	first := readAgentTaskMigrationMap(t, db, source.ID)
	closeAgentTaskMigrationTestDB(t, db)

	restarted := openAgentTaskMigrationTestDB(t, path)
	if err := MigrateAgentTasks(restarted); err != nil {
		t.Fatalf("restarted AgentTask migration: %v", err)
	}
	second := readAgentTaskMigrationMap(t, restarted, source.ID)
	if first.GoalID != second.GoalID ||
		first.TaskID != second.TaskID ||
		first.GoalNodeID != second.GoalNodeID ||
		first.StepID != second.StepID ||
		first.AttemptID != second.AttemptID {
		t.Fatalf("migration identities changed: first=%+v second=%+v", first, second)
	}
	if second.State != AgentTaskMigrationStateMigrated || second.BlockReason != "" {
		t.Fatalf("migration state = %+v", second)
	}

	assertAgentTaskMigrationCount(t, restarted, &AgentTask{}, 1)
	assertAgentTaskMigrationCount(t, restarted, &AgentTaskGoalMap{}, 1)
	assertAgentTaskMigrationCount(t, restarted, &AgentGoal{}, 1)
	assertAgentTaskMigrationCount(t, restarted, &AgentGoalNode{}, 1)
	assertAgentTaskMigrationCount(t, restarted, &TaskRun{}, 1)
	assertAgentTaskMigrationCount(t, restarted, &ExecutionStep{}, 1)

	var goal AgentGoal
	if err := restarted.First(&goal, "goal_id = ?", second.GoalID).Error; err != nil {
		t.Fatalf("read migrated Goal: %v", err)
	}
	if goal.OwnerPTID != source.OwnerActorID ||
		goal.Status != int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING) {
		t.Fatalf("migrated Goal = %+v", goal)
	}
	var task TaskRun
	if err := restarted.First(&task, "task_id = ?", second.TaskID).Error; err != nil {
		t.Fatalf("read migrated TaskRun: %v", err)
	}
	if task.GoalID != second.GoalID ||
		task.GoalNodeID != second.GoalNodeID ||
		task.RootStepID != second.StepID ||
		task.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING) {
		t.Fatalf("migrated TaskRun = %+v", task)
	}
}

func TestAgentTaskMigrationBlocksAmbiguousRowsAndPreservesSources(t *testing.T) {
	db := openAgentTaskMigrationTestDB(
		t,
		filepath.Join(t.TempDir(), "agent-task-migration-blocked.db"),
	)
	now := time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
	sources := []AgentTask{
		{
			ID:           "legacy-owner-ambiguous",
			Title:        "Unknown owner",
			AgentID:      "agent-1",
			Status:       "running",
			SubtasksJSON: "[]",
			OwnerActorID: "actor-1",
			CreatedAt:    now,
			UpdatedAt:    now,
		},
		{
			ID:           "legacy-terminal-ambiguous",
			Title:        "Ambiguous completion",
			AgentID:      "agent-1",
			Status:       "completed",
			Progress:     99,
			SubtasksJSON: "[]",
			OwnerActorID: "ptid:actor-1",
			CreatedAt:    now,
			UpdatedAt:    now,
		},
	}
	if err := db.Create(&sources).Error; err != nil {
		t.Fatalf("seed blocked AgentTasks: %v", err)
	}

	if err := MigrateAgentTasks(db); err != nil {
		t.Fatalf("migrate blocked AgentTasks: %v", err)
	}
	ownerBlocked := readAgentTaskMigrationMap(t, db, sources[0].ID)
	if ownerBlocked.State != AgentTaskMigrationStateBlocked ||
		ownerBlocked.BlockReason != "owner_not_canonical" {
		t.Fatalf("owner migration = %+v", ownerBlocked)
	}
	terminalBlocked := readAgentTaskMigrationMap(t, db, sources[1].ID)
	if terminalBlocked.State != AgentTaskMigrationStateBlocked ||
		terminalBlocked.BlockReason != "terminal_state_ambiguous" {
		t.Fatalf("terminal migration = %+v", terminalBlocked)
	}

	assertAgentTaskMigrationCount(t, db, &AgentTask{}, 2)
	assertAgentTaskMigrationCount(t, db, &AgentTaskGoalMap{}, 2)
	assertAgentTaskMigrationCount(t, db, &AgentGoal{}, 0)
	assertAgentTaskMigrationCount(t, db, &TaskRun{}, 0)
}

func openAgentTaskMigrationTestDB(t *testing.T, path string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatalf("open AgentTask migration database: %v", err)
	}
	if err := db.AutoMigrate(&AgentTask{}); err != nil {
		t.Fatalf("migrate legacy AgentTask schema: %v", err)
	}
	return db
}

func closeAgentTaskMigrationTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open AgentTask migration sql database: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close AgentTask migration database: %v", err)
	}
}

func readAgentTaskMigrationMap(
	t *testing.T,
	db *gorm.DB,
	legacyTaskID string,
) AgentTaskGoalMap {
	t.Helper()
	var row AgentTaskGoalMap
	if err := db.First(&row, "legacy_task_id = ?", legacyTaskID).Error; err != nil {
		t.Fatalf("read AgentTask migration map: %v", err)
	}
	return row
}

func assertAgentTaskMigrationCount(
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
