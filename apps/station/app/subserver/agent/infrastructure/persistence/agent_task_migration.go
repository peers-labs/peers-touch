package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AgentTaskMigrationStateMigrated = "migrated"
	AgentTaskMigrationStateBlocked  = "blocked"
)

// AgentTaskGoalMap is the durable, idempotent bridge from a legacy AgentTask
// source row to the canonical Goal and TaskRun identities created for it.
type AgentTaskGoalMap struct {
	LegacyTaskID    string    `gorm:"column:legacy_task_id;primaryKey;type:varchar(36)"`
	OwnerPTID       string    `gorm:"column:owner_ptid;not null;type:text;index:idx_agent_task_goal_maps_owner"`
	GoalID          string    `gorm:"column:goal_id;not null;type:varchar(64);uniqueIndex:idx_agent_task_goal_maps_goal"`
	TaskID          string    `gorm:"column:task_id;not null;type:varchar(36);uniqueIndex:idx_agent_task_goal_maps_task"`
	GoalNodeID      string    `gorm:"column:goal_node_id;not null;type:varchar(64)"`
	StepID          string    `gorm:"column:step_id;not null;type:varchar(36)"`
	AttemptID       string    `gorm:"column:attempt_id;not null;type:varchar(36)"`
	State           string    `gorm:"column:state;not null;type:varchar(16);index:idx_agent_task_goal_maps_state"`
	BlockReason     string    `gorm:"column:block_reason;not null;type:varchar(64);default:''"`
	SourceStatus    string    `gorm:"column:source_status;not null;type:varchar(20)"`
	SourceUpdatedAt time.Time `gorm:"column:source_updated_at;not null"`
	CreatedAt       time.Time `gorm:"column:created_at;not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null"`
}

func (AgentTaskGoalMap) TableName() string {
	return "agent_task_goal_maps"
}

// MigrateAgentTasks preserves every legacy source row while materializing a
// stable Goal/TaskRun identity. Invalid ownership or ambiguous terminal state
// is recorded as blocked and never promoted into canonical execution state.
func MigrateAgentTasks(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("AgentTask migration requires database")
	}
	if err := db.AutoMigrate(
		&AgentTaskGoalMap{},
		&AgentGoal{},
		&AgentGoalNode{},
		&TaskRun{},
		&ExecutionStep{},
	); err != nil {
		return fmt.Errorf("migrate AgentTask mapping schema: %w", err)
	}
	if !db.Migrator().HasTable(&AgentTask{}) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var sources []AgentTask
		if err := tx.Order("created_at ASC, id ASC").Find(&sources).Error; err != nil {
			return fmt.Errorf("load legacy AgentTask rows: %w", err)
		}
		for index := range sources {
			if err := migrateAgentTask(tx, &sources[index]); err != nil {
				return err
			}
		}
		return nil
	})
}

func ListAgentTaskGoalMaps(
	ctx context.Context,
	db *gorm.DB,
	ownerPTID string,
) ([]AgentTaskGoalMap, error) {
	if db == nil {
		return nil, fmt.Errorf("AgentTask migration readback requires database")
	}
	var rows []AgentTaskGoalMap
	if err := db.WithContext(ctx).
		Where("owner_ptid = ?", strings.TrimSpace(ownerPTID)).
		Order("source_updated_at DESC, legacy_task_id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list AgentTask migration readback: %w", err)
	}
	return rows, nil
}

func migrateAgentTask(tx *gorm.DB, source *AgentTask) error {
	if source == nil {
		return nil
	}
	ids := agentTaskMigrationIDs(source.ID)
	now := normalizedMigrationTime(source.UpdatedAt, source.CreatedAt)
	mapping := AgentTaskGoalMap{
		LegacyTaskID:    source.ID,
		OwnerPTID:       strings.TrimSpace(source.OwnerActorID),
		GoalID:          ids.goalID,
		TaskID:          ids.taskID,
		GoalNodeID:      ids.nodeID,
		StepID:          ids.stepID,
		AttemptID:       ids.attemptID,
		State:           AgentTaskMigrationStateMigrated,
		SourceStatus:    strings.ToLower(strings.TrimSpace(source.Status)),
		SourceUpdatedAt: now,
		CreatedAt:       normalizedMigrationTime(source.CreatedAt),
		UpdatedAt:       now,
	}
	if reason := agentTaskMigrationBlockReason(source); reason != "" {
		mapping.State = AgentTaskMigrationStateBlocked
		mapping.BlockReason = reason
		return upsertAgentTaskGoalMap(tx, &mapping)
	}

	goalStatus, taskStatus, stepStatus := agentTaskMigrationStatuses(source.Status)
	endedAt := agentTaskMigrationEndedAt(source, taskStatus)
	metaJSON, err := json.Marshal(map[string]string{
		"attempt_id":           ids.attemptID,
		"goal_id":              ids.goalID,
		"goal_node_id":         ids.nodeID,
		"legacy_agent_task_id": source.ID,
		"migration_state":      AgentTaskMigrationStateMigrated,
		"root_step_id":         ids.stepID,
	})
	if err != nil {
		return fmt.Errorf("encode AgentTask %s migration metadata: %w", source.ID, err)
	}
	goal := AgentGoal{
		GoalID:                 ids.goalID,
		OwnerPTID:              strings.TrimSpace(source.OwnerActorID),
		Title:                  strings.TrimSpace(source.Title),
		Outcome:                firstMigrationValue(source.Description, source.Title),
		NonGoalsJSON:           []byte("[]"),
		ConstraintsJSON:        []byte("[]"),
		BudgetJSON:             []byte("{}"),
		AcceptanceCriteriaJSON: []byte("[]"),
		Status:                 int32(goalStatus),
		Revision:               1,
		GraphRevision:          1,
		CreateIdempotencyKey:   "migration:agent-task:" + source.ID,
		CreatePayloadHash:      agentTaskMigrationFingerprint(source),
		CreatedAt:              normalizedMigrationTime(source.CreatedAt),
		UpdatedAt:              now,
	}
	task := TaskRun{
		TaskID:         ids.taskID,
		Title:          strings.TrimSpace(source.Title),
		Description:    firstMigrationValue(source.Description, source.Title),
		Surface:        int32(model.TaskSurface_TASK_SURFACE_API),
		Status:         int32(taskStatus),
		OwnerActorPTID: strings.TrimSpace(source.OwnerActorID),
		MetaJSON:       string(metaJSON),
		CreatedAt:      normalizedMigrationTime(source.CreatedAt),
		StartedAt:      normalizedMigrationTime(source.CreatedAt),
		UpdatedAt:      now,
		EndedAt:        endedAt,
		GoalID:         ids.goalID,
		GoalNodeID:     ids.nodeID,
		RootStepID:     ids.stepID,
	}
	node := AgentGoalNode{
		GoalID:                  ids.goalID,
		NodeID:                  ids.nodeID,
		TaskID:                  ids.taskID,
		Title:                   task.Title,
		Description:             task.Description,
		Status:                  int32(stepStatus),
		PrerequisiteNodeIDsJSON: "[]",
		CreatedAt:               task.CreatedAt,
		UpdatedAt:               now,
	}
	step := ExecutionStep{
		StepID:            ids.stepID,
		TaskID:            ids.taskID,
		AgentID:           strings.TrimSpace(source.AgentID),
		Role:              "executor",
		Description:       task.Description,
		Status:            int32(stepStatus),
		Attempt:           1,
		AttemptID:         ids.attemptID,
		EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
		ResultSummary:     firstMigrationValue(source.Result, source.Error),
		StartedAt:         task.StartedAt,
		EndedAt:           endedAt,
	}

	if err := upsertMigratedAgentGoal(tx, &goal); err != nil {
		return err
	}
	if err := upsertMigratedTaskRun(tx, &task); err != nil {
		return err
	}
	if err := upsertMigratedGoalNode(tx, &node); err != nil {
		return err
	}
	if err := upsertMigratedExecutionStep(tx, &step); err != nil {
		return err
	}
	return upsertAgentTaskGoalMap(tx, &mapping)
}

type agentTaskCanonicalIDs struct {
	goalID    string
	taskID    string
	nodeID    string
	stepID    string
	attemptID string
}

func agentTaskMigrationIDs(sourceID string) agentTaskCanonicalIDs {
	return agentTaskCanonicalIDs{
		goalID:    agentTaskMigrationID("goal", sourceID),
		taskID:    agentTaskMigrationID("task", sourceID),
		nodeID:    agentTaskMigrationID("gnode", sourceID),
		stepID:    agentTaskMigrationID("step", sourceID),
		attemptID: agentTaskMigrationID("attempt", sourceID),
	}
}

func agentTaskMigrationID(prefix string, sourceID string) string {
	sum := sha256.Sum256([]byte("agent-task-migration-v1\x00" + sourceID + "\x00" + prefix))
	return prefix + "_" + hex.EncodeToString(sum[:12])
}

func agentTaskMigrationFingerprint(source *AgentTask) string {
	parts := []string{
		source.ID,
		source.OwnerActorID,
		source.AgentID,
		source.Title,
		source.Description,
		source.Status,
		source.Result,
		source.Error,
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

func agentTaskMigrationBlockReason(source *AgentTask) string {
	owner := strings.TrimSpace(source.OwnerActorID)
	if owner == "" {
		return "owner_missing"
	}
	if !strings.HasPrefix(owner, "ptid:") {
		return "owner_not_canonical"
	}
	if strings.TrimSpace(source.AgentID) == "" {
		return "agent_missing"
	}
	switch strings.ToLower(strings.TrimSpace(source.Status)) {
	case "pending", "running", "paused", "cancelled":
		return ""
	case "completed":
		if source.CompletedAt == nil || source.Progress != 100 ||
			strings.TrimSpace(source.Error) != "" {
			return "terminal_state_ambiguous"
		}
		return ""
	case "failed":
		if strings.TrimSpace(source.Error) == "" {
			return "terminal_state_ambiguous"
		}
		return ""
	default:
		return "status_unsupported"
	}
}

func agentTaskMigrationStatuses(
	status string,
) (
	model.AgentGoalStatus,
	model.CollaborationTaskStatus,
	model.TaskNodeStatus,
) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "running":
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
			model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING
	case "paused":
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_NEEDS_USER,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED,
			model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING
	case "completed":
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_ACCEPTING,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
			model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED
	case "failed":
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_FAILED,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
			model.TaskNodeStatus_TASK_NODE_STATUS_FAILED
	case "cancelled":
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED,
			model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED
	default:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_READY,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING,
			model.TaskNodeStatus_TASK_NODE_STATUS_PENDING
	}
}

func agentTaskMigrationEndedAt(
	source *AgentTask,
	status model.CollaborationTaskStatus,
) *time.Time {
	if source.CompletedAt != nil {
		endedAt := source.CompletedAt.UTC()
		return &endedAt
	}
	switch status {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		endedAt := normalizedMigrationTime(source.UpdatedAt, source.CreatedAt)
		return &endedAt
	default:
		return nil
	}
}

func normalizedMigrationTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value.UTC()
		}
	}
	return time.Unix(0, 0).UTC()
}

func firstMigrationValue(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return "Migrated Agent task"
}

func upsertAgentTaskGoalMap(tx *gorm.DB, mapping *AgentTaskGoalMap) error {
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "legacy_task_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"owner_ptid",
			"goal_id",
			"task_id",
			"goal_node_id",
			"step_id",
			"attempt_id",
			"state",
			"block_reason",
			"source_status",
			"source_updated_at",
			"updated_at",
		}),
	}).Create(mapping).Error
}

func upsertMigratedAgentGoal(tx *gorm.DB, goal *AgentGoal) error {
	var existing AgentGoal
	err := tx.Where("goal_id = ?", goal.GoalID).First(&existing).Error
	if err == nil && (existing.OwnerPTID != goal.OwnerPTID ||
		existing.CreateIdempotencyKey != goal.CreateIdempotencyKey) {
		return fmt.Errorf("AgentTask migration Goal identity %s collides", goal.GoalID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect AgentTask migration Goal %s: %w", goal.GoalID, err)
	}
	if err == gorm.ErrRecordNotFound {
		if createErr := tx.Create(goal).Error; createErr != nil {
			return fmt.Errorf("create migrated AgentTask Goal %s: %w", goal.GoalID, createErr)
		}
		return nil
	}
	return tx.Model(&existing).Updates(map[string]interface{}{
		"title":               goal.Title,
		"outcome":             goal.Outcome,
		"status":              goal.Status,
		"create_payload_hash": goal.CreatePayloadHash,
		"updated_at":          goal.UpdatedAt,
	}).Error
}

func upsertMigratedTaskRun(tx *gorm.DB, task *TaskRun) error {
	var existing TaskRun
	err := tx.Where("task_id = ?", task.TaskID).First(&existing).Error
	if err == nil && (existing.OwnerActorPTID != task.OwnerActorPTID ||
		existing.GoalID != task.GoalID ||
		existing.GoalNodeID != task.GoalNodeID) {
		return fmt.Errorf("AgentTask migration TaskRun identity %s collides", task.TaskID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect AgentTask migration TaskRun %s: %w", task.TaskID, err)
	}
	if err == gorm.ErrRecordNotFound {
		if createErr := tx.Create(task).Error; createErr != nil {
			return fmt.Errorf("create migrated AgentTask TaskRun %s: %w", task.TaskID, createErr)
		}
		return nil
	}
	return tx.Model(&existing).Updates(map[string]interface{}{
		"title":       task.Title,
		"description": task.Description,
		"status":      task.Status,
		"meta_json":   task.MetaJSON,
		"updated_at":  task.UpdatedAt,
		"ended_at":    task.EndedAt,
	}).Error
}

func upsertMigratedGoalNode(tx *gorm.DB, node *AgentGoalNode) error {
	var existing AgentGoalNode
	err := tx.Where("goal_id = ? AND node_id = ?", node.GoalID, node.NodeID).
		First(&existing).Error
	if err == nil && existing.TaskID != node.TaskID {
		return fmt.Errorf("AgentTask migration Goal node identity %s collides", node.NodeID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect AgentTask migration Goal node %s: %w", node.NodeID, err)
	}
	if err == gorm.ErrRecordNotFound {
		if createErr := tx.Create(node).Error; createErr != nil {
			return fmt.Errorf("create migrated AgentTask Goal node %s: %w", node.NodeID, createErr)
		}
		return nil
	}
	return tx.Model(&existing).Updates(map[string]interface{}{
		"title":       node.Title,
		"description": node.Description,
		"status":      node.Status,
		"updated_at":  node.UpdatedAt,
	}).Error
}

func upsertMigratedExecutionStep(tx *gorm.DB, step *ExecutionStep) error {
	var existing ExecutionStep
	err := tx.Where("step_id = ?", step.StepID).First(&existing).Error
	if err == nil && (existing.TaskID != step.TaskID ||
		existing.AttemptID != step.AttemptID) {
		return fmt.Errorf("AgentTask migration ExecutionStep identity %s collides", step.StepID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect AgentTask migration ExecutionStep %s: %w", step.StepID, err)
	}
	if err == gorm.ErrRecordNotFound {
		if createErr := tx.Create(step).Error; createErr != nil {
			return fmt.Errorf("create migrated AgentTask ExecutionStep %s: %w", step.StepID, createErr)
		}
		return nil
	}
	return tx.Model(&existing).Updates(map[string]interface{}{
		"agent_id":       step.AgentID,
		"description":    step.Description,
		"status":         step.Status,
		"result_summary": step.ResultSummary,
		"ended_at":       step.EndedAt,
	}).Error
}
