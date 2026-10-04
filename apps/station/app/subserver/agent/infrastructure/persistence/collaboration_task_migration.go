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
	CollaborationTaskMigrationStateMigrated = "migrated"
	CollaborationTaskMigrationStateBlocked  = "blocked"
)

// CollaborationTaskGoalMap preserves the legacy Atelier task key while
// exposing the canonical Goal and TaskRun identities materialized from it.
type CollaborationTaskGoalMap struct {
	LegacyTaskID  string `gorm:"column:legacy_task_id;primaryKey;type:varchar(36)"`
	OwnerPTID     string `gorm:"column:owner_ptid;not null;type:text;index:idx_agent_collaboration_task_goal_maps_owner"`
	GoalID        string `gorm:"column:goal_id;not null;type:varchar(64);uniqueIndex:idx_agent_collaboration_task_goal_maps_goal"`
	TaskID        string `gorm:"column:task_id;not null;type:varchar(36);uniqueIndex:idx_agent_collaboration_task_goal_maps_task"`
	GoalNodeID    string `gorm:"column:goal_node_id;not null;type:varchar(64)"`
	RootStepID    string `gorm:"column:root_step_id;not null;type:varchar(36)"`
	RootAttemptID string `gorm:"column:root_attempt_id;not null;type:varchar(36)"`

	State           string    `gorm:"column:state;not null;type:varchar(16);index:idx_agent_collaboration_task_goal_maps_state"`
	BlockReason     string    `gorm:"column:block_reason;not null;type:varchar(64);default:''"`
	SourceStatus    int32     `gorm:"column:source_status;not null;type:integer"`
	SourceUpdatedAt time.Time `gorm:"column:source_updated_at;not null"`
	CreatedAt       time.Time `gorm:"column:created_at;not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null"`
}

func (CollaborationTaskGoalMap) TableName() string {
	return "agent_collaboration_task_goal_maps"
}

// MigrateCollaborationTasks is a source-preserving, idempotent bridge. It
// never mutates CollaborationTask rows and never trusts metadata as identity.
func MigrateCollaborationTasks(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("CollaborationTask migration requires database")
	}
	if err := db.AutoMigrate(
		&CollaborationTaskGoalMap{},
		&AgentGoal{},
		&AgentGoalNode{},
		&TaskRun{},
		&ExecutionStep{},
	); err != nil {
		return fmt.Errorf("migrate CollaborationTask mapping schema: %w", err)
	}
	if !db.Migrator().HasTable(&CollaborationTask{}) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var sources []CollaborationTask
		if err := tx.Order("created_at ASC, id ASC").Find(&sources).Error; err != nil {
			return fmt.Errorf("load legacy CollaborationTask rows: %w", err)
		}
		for index := range sources {
			if err := migrateCollaborationTask(tx, &sources[index]); err != nil {
				return err
			}
		}
		return nil
	})
}

func ListCollaborationTaskGoalMaps(
	ctx context.Context,
	db *gorm.DB,
	ownerPTID string,
) ([]CollaborationTaskGoalMap, error) {
	if db == nil {
		return nil, fmt.Errorf("CollaborationTask migration readback requires database")
	}
	if !db.Migrator().HasTable(&CollaborationTaskGoalMap{}) {
		return []CollaborationTaskGoalMap{}, nil
	}
	var rows []CollaborationTaskGoalMap
	if err := db.WithContext(ctx).
		Where("owner_ptid = ?", strings.TrimSpace(ownerPTID)).
		Order("source_updated_at DESC, legacy_task_id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list CollaborationTask migration readback: %w", err)
	}
	return rows, nil
}

type collaborationTaskCanonicalIDs struct {
	goalID        string
	taskID        string
	goalNodeID    string
	rootStepID    string
	rootAttemptID string
}

type collaborationMigrationTaskIdentity struct {
	TaskID         string
	OwnerActorPTID string
	GoalID         string
	GoalNodeID     string
	RootStepID     string
	MetaJSON       string
}

func migrateCollaborationTask(tx *gorm.DB, source *CollaborationTask) error {
	if source == nil {
		return nil
	}
	meta, metaErr := decodeCollaborationMigrationMeta(source.MetaJSON)
	ids := collaborationTaskMigrationIDs(source.ID)
	var existingMap CollaborationTaskGoalMap
	mapErr := tx.Where("legacy_task_id = ?", source.ID).First(&existingMap).Error
	if mapErr == nil {
		ids = collaborationTaskCanonicalIDs{
			goalID:        existingMap.GoalID,
			taskID:        existingMap.TaskID,
			goalNodeID:    existingMap.GoalNodeID,
			rootStepID:    existingMap.RootStepID,
			rootAttemptID: existingMap.RootAttemptID,
		}
	} else if mapErr != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect CollaborationTask migration map %s: %w", source.ID, mapErr)
	}

	var existingTask collaborationMigrationTaskIdentity
	taskErr := tx.Model(&TaskRun{}).
		Select("task_id", "owner_actor_ptid", "goal_id", "goal_node_id", "root_step_id", "meta_json").
		Where("task_id = ?", ids.taskID).
		First(&existingTask).Error
	if taskErr != nil && taskErr != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect CollaborationTask TaskRun %s: %w", ids.taskID, taskErr)
	}
	if mapErr == gorm.ErrRecordNotFound && taskErr == nil && strings.TrimSpace(existingTask.RootStepID) != "" {
		ids.rootStepID = strings.TrimSpace(existingTask.RootStepID)
	}
	if mapErr == gorm.ErrRecordNotFound && taskErr == nil && ids.rootStepID == collaborationTaskMigrationID("step", source.ID) {
		if step, ok, err := firstCollaborationMigrationStep(tx, ids.taskID); err != nil {
			return err
		} else if ok {
			ids.rootStepID = step.StepID
			ids.rootAttemptID = collaborationMigrationAttemptID(step.TaskID, step.StepID, step.AttemptID)
		}
	}

	now := collaborationMigrationSourceTime(source)
	mapping := CollaborationTaskGoalMap{
		LegacyTaskID:    source.ID,
		OwnerPTID:       strings.TrimSpace(source.GoalOwnerPTID),
		GoalID:          ids.goalID,
		TaskID:          ids.taskID,
		GoalNodeID:      ids.goalNodeID,
		RootStepID:      ids.rootStepID,
		RootAttemptID:   ids.rootAttemptID,
		State:           CollaborationTaskMigrationStateMigrated,
		SourceStatus:    source.Status,
		SourceUpdatedAt: now,
		CreatedAt:       normalizedMigrationTime(source.CreatedAt),
		UpdatedAt:       now,
	}
	if reason := collaborationTaskMigrationBlockReason(source, meta, metaErr, ids, taskErr, &existingTask); reason != "" {
		mapping.State = CollaborationTaskMigrationStateBlocked
		mapping.BlockReason = reason
		return upsertCollaborationTaskGoalMap(tx, &mapping)
	}

	goalStatus, taskStatus, stepStatus := collaborationTaskMigrationStatuses(source.Status)
	goal := AgentGoal{
		GoalID:                 ids.goalID,
		OwnerPTID:              strings.TrimSpace(source.GoalOwnerPTID),
		WorkspaceID:            strings.TrimSpace(source.WorkspaceID),
		Title:                  strings.TrimSpace(source.Title),
		Outcome:                firstMigrationValue(source.Description, source.Title),
		NonGoalsJSON:           []byte("[]"),
		ConstraintsJSON:        []byte("[]"),
		BudgetJSON:             collaborationMigrationBudget(source),
		AcceptanceCriteriaJSON: []byte("[]"),
		Status:                 int32(goalStatus),
		Revision:               1,
		GraphRevision:          1,
		CreateIdempotencyKey:   "migration:collaboration-task:" + source.ID,
		CreatePayloadHash:      collaborationTaskMigrationFingerprint(source),
		CreatedAt:              normalizedMigrationTime(source.CreatedAt),
		UpdatedAt:              now,
	}
	if err := ensureCollaborationMigrationGoal(tx, &goal); err != nil {
		return err
	}

	rootStepID, rootAttemptID, err := ensureCollaborationMigrationSteps(
		tx,
		source,
		ids.taskID,
		ids.rootStepID,
		ids.rootAttemptID,
		stepStatus,
	)
	if err != nil {
		return err
	}
	mapping.RootStepID = rootStepID
	mapping.RootAttemptID = rootAttemptID

	if err := ensureCollaborationMigrationTaskRun(
		tx,
		source,
		ids,
		rootStepID,
		taskStatus,
		now,
	); err != nil {
		return err
	}
	node := AgentGoalNode{
		GoalID:                  ids.goalID,
		NodeID:                  ids.goalNodeID,
		TaskID:                  ids.taskID,
		Title:                   firstMigrationValue(source.Title),
		Description:             firstMigrationValue(source.Description, source.Title),
		Status:                  int32(stepStatus),
		PrerequisiteNodeIDsJSON: "[]",
		CreatedAt:               normalizedMigrationTime(source.CreatedAt),
		UpdatedAt:               now,
	}
	if err := ensureCollaborationMigrationGoalNode(tx, &node); err != nil {
		return err
	}
	return upsertCollaborationTaskGoalMap(tx, &mapping)
}

func collaborationTaskMigrationIDs(sourceID string) collaborationTaskCanonicalIDs {
	return collaborationTaskCanonicalIDs{
		goalID:        collaborationTaskMigrationID("goal", sourceID),
		taskID:        strings.TrimSpace(sourceID),
		goalNodeID:    collaborationTaskMigrationID("gnode", sourceID),
		rootStepID:    collaborationTaskMigrationID("step", sourceID),
		rootAttemptID: collaborationTaskMigrationID("attempt", sourceID),
	}
}

func collaborationTaskMigrationID(prefix string, sourceID string) string {
	sum := sha256.Sum256([]byte("collaboration-task-migration-v1\x00" + sourceID + "\x00" + prefix))
	return prefix + "_" + hex.EncodeToString(sum[:12])
}

func collaborationTaskMigrationFingerprint(source *CollaborationTask) string {
	parts := []string{
		source.ID,
		source.GoalOwnerPTID,
		source.WorkspaceID,
		source.Title,
		source.Description,
		fmt.Sprintf("%d", source.EngineType),
		fmt.Sprintf("%d", source.Status),
		source.MetaJSON,
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

func collaborationTaskMigrationBlockReason(
	source *CollaborationTask,
	meta map[string]string,
	metaErr error,
	ids collaborationTaskCanonicalIDs,
	taskErr error,
	existingTask *collaborationMigrationTaskIdentity,
) string {
	if strings.TrimSpace(source.GoalOwnerPTID) == "" {
		return "owner_missing"
	}
	if metaErr != nil {
		return "metadata_invalid"
	}
	if explicitTaskID := strings.TrimSpace(meta["task_id"]); explicitTaskID != "" && explicitTaskID != ids.taskID {
		return "identity_metadata_ambiguous"
	}
	explicitGoalID := strings.TrimSpace(meta["goal_id"])
	explicitProjectID := strings.TrimSpace(meta["project_id"])
	if explicitGoalID != "" && explicitProjectID != "" && explicitGoalID != explicitProjectID {
		return "identity_metadata_ambiguous"
	}
	if explicitGoalID != "" && explicitGoalID != ids.goalID {
		return "identity_metadata_ambiguous"
	}
	if taskErr == nil && existingTask != nil {
		if owner := strings.TrimSpace(existingTask.OwnerActorPTID); owner != "" && owner != strings.TrimSpace(source.GoalOwnerPTID) {
			return "task_run_owner_conflict"
		}
		if goalID := strings.TrimSpace(existingTask.GoalID); goalID != "" && goalID != ids.goalID {
			return "task_run_goal_conflict"
		}
		if nodeID := strings.TrimSpace(existingTask.GoalNodeID); nodeID != "" && nodeID != ids.goalNodeID {
			return "task_run_goal_node_conflict"
		}
	}
	switch model.CollaborationTaskStatus(source.Status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return ""
	default:
		return "status_unsupported"
	}
}

func collaborationTaskMigrationStatuses(
	status int32,
) (
	model.AgentGoalStatus,
	model.CollaborationTaskStatus,
	model.TaskNodeStatus,
) {
	switch model.CollaborationTaskStatus(status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
			model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_NEEDS_USER,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED,
			model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_ACCEPTING,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
			model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_FAILED,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
			model.TaskNodeStatus_TASK_NODE_STATUS_FAILED
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED,
			model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED
	default:
		return model.AgentGoalStatus_AGENT_GOAL_STATUS_READY,
			model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING,
			model.TaskNodeStatus_TASK_NODE_STATUS_PENDING
	}
}

func ensureCollaborationMigrationGoal(tx *gorm.DB, goal *AgentGoal) error {
	var existing AgentGoal
	err := tx.Where("goal_id = ?", goal.GoalID).First(&existing).Error
	if err == nil {
		if existing.OwnerPTID != goal.OwnerPTID ||
			existing.CreateIdempotencyKey != goal.CreateIdempotencyKey {
			return fmt.Errorf("CollaborationTask migration Goal identity %s collides", goal.GoalID)
		}
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect CollaborationTask migration Goal %s: %w", goal.GoalID, err)
	}
	if err := tx.Create(goal).Error; err != nil {
		return fmt.Errorf("create migrated CollaborationTask Goal %s: %w", goal.GoalID, err)
	}
	return nil
}

func ensureCollaborationMigrationTaskRun(
	tx *gorm.DB,
	source *CollaborationTask,
	ids collaborationTaskCanonicalIDs,
	rootStepID string,
	status model.CollaborationTaskStatus,
	now time.Time,
) error {
	var existing collaborationMigrationTaskIdentity
	err := tx.Model(&TaskRun{}).
		Select("task_id", "owner_actor_ptid", "goal_id", "goal_node_id", "root_step_id", "meta_json").
		Where("task_id = ?", ids.taskID).
		First(&existing).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect CollaborationTask migration TaskRun %s: %w", ids.taskID, err)
	}
	metaJSON, metaErr := mergeCollaborationMigrationTaskMeta(existing.MetaJSON, source.ID, ids, rootStepID)
	if metaErr != nil {
		return fmt.Errorf("encode CollaborationTask %s migration metadata: %w", source.ID, metaErr)
	}
	if err == gorm.ErrRecordNotFound {
		task := TaskRun{
			TaskID:         ids.taskID,
			Title:          strings.TrimSpace(source.Title),
			Description:    firstMigrationValue(source.Description, source.Title),
			Surface:        int32(model.TaskSurface_TASK_SURFACE_CANVAS),
			Status:         int32(status),
			OwnerActorPTID: strings.TrimSpace(source.GoalOwnerPTID),
			WorkspaceID:    strings.TrimSpace(source.WorkspaceID),
			MetaJSON:       metaJSON,
			CreatedAt:      normalizedMigrationTime(source.CreatedAt),
			StartedAt:      normalizedMigrationTime(source.StartedAt, source.CreatedAt),
			UpdatedAt:      now,
			EndedAt:        collaborationTaskMigrationEndedAt(source),
			GoalID:         ids.goalID,
			GoalNodeID:     ids.goalNodeID,
			RootStepID:     rootStepID,
		}
		if err := tx.Create(&task).Error; err != nil {
			return fmt.Errorf("create migrated CollaborationTask TaskRun %s: %w", ids.taskID, err)
		}
		return nil
	}
	return tx.Model(&TaskRun{}).
		Where("task_id = ?", ids.taskID).
		Updates(map[string]interface{}{
			"goal_id":      ids.goalID,
			"goal_node_id": ids.goalNodeID,
			"root_step_id": rootStepID,
			"meta_json":    metaJSON,
		}).Error
}

func ensureCollaborationMigrationGoalNode(tx *gorm.DB, node *AgentGoalNode) error {
	var existing AgentGoalNode
	err := tx.Where("goal_id = ? AND node_id = ?", node.GoalID, node.NodeID).First(&existing).Error
	if err == nil {
		if existing.TaskID != node.TaskID {
			return fmt.Errorf("CollaborationTask migration Goal node identity %s collides", node.NodeID)
		}
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect CollaborationTask migration Goal node %s: %w", node.NodeID, err)
	}
	if err := tx.Create(node).Error; err != nil {
		return fmt.Errorf("create migrated CollaborationTask Goal node %s: %w", node.NodeID, err)
	}
	return nil
}

func ensureCollaborationMigrationSteps(
	tx *gorm.DB,
	source *CollaborationTask,
	taskID string,
	rootStepID string,
	rootAttemptID string,
	fallbackStatus model.TaskNodeStatus,
) (string, string, error) {
	if existing, ok, err := firstCollaborationMigrationStep(tx, taskID); err != nil {
		return "", "", err
	} else if ok {
		selectExistingRoot := strings.TrimSpace(rootStepID) == "" ||
			rootStepID == collaborationTaskMigrationID("step", source.ID)
		if selectExistingRoot {
			rootStepID = existing.StepID
			rootAttemptID = collaborationMigrationAttemptID(existing.TaskID, existing.StepID, existing.AttemptID)
		}
		if selectExistingRoot && strings.TrimSpace(existing.AttemptID) == "" {
			if err := tx.Model(&ExecutionStep{}).
				Where("step_id = ?", existing.StepID).
				Update("attempt_id", rootAttemptID).Error; err != nil {
				return "", "", fmt.Errorf("backfill CollaborationTask root attempt %s: %w", existing.StepID, err)
			}
		}
	}

	var nodes []CollaborationTaskNode
	if err := tx.Where("task_id = ?", source.ID).
		Order("started_at ASC, id ASC").
		Find(&nodes).Error; err != nil {
		return "", "", fmt.Errorf("load CollaborationTask nodes %s: %w", source.ID, err)
	}
	stepIDByNodeID := make(map[string]string, len(nodes))
	for index := range nodes {
		stepIDByNodeID[nodes[index].ID] = collaborationTaskMigrationID("step", source.ID+"\x00"+nodes[index].ID)
	}
	for index := range nodes {
		node := nodes[index]
		stepID := stepIDByNodeID[node.ID]
		attemptID := collaborationTaskMigrationID("attempt", source.ID+"\x00"+node.ID)
		parentStepID := stepIDByNodeID[strings.TrimSpace(node.ParentNodeID)]
		if parentStepID == "" {
			var prerequisites []string
			_ = json.Unmarshal([]byte(node.PrerequisiteNodeIDs), &prerequisites)
			if len(prerequisites) > 0 {
				parentStepID = stepIDByNodeID[strings.TrimSpace(prerequisites[0])]
			}
		}
		step := ExecutionStep{
			StepID:            stepID,
			TaskID:            taskID,
			ParentStepID:      parentStepID,
			AgentID:           firstMigrationValue(node.AgentID, "legacy-collaboration"),
			Role:              strings.TrimSpace(node.Role),
			Description:       firstMigrationValue(node.Description, source.Description, source.Title),
			Status:            node.Status,
			Attempt:           1,
			AttemptID:         attemptID,
			EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
			ResultSummary:     strings.TrimSpace(node.ResultSummary),
			StartedAt:         normalizedMigrationTime(node.StartedAt, source.StartedAt, source.CreatedAt),
			EndedAt:           collaborationNodeMigrationEndedAt(&node),
		}
		if err := ensureCollaborationMigrationStep(tx, &step); err != nil {
			return "", "", err
		}
		if rootStepID == "" || rootStepID == collaborationTaskMigrationID("step", source.ID) {
			rootStepID = stepID
			rootAttemptID = attemptID
		}
	}
	if strings.TrimSpace(rootStepID) == "" ||
		(rootStepID == collaborationTaskMigrationID("step", source.ID) && len(nodes) == 0) {
		rootStepID = collaborationTaskMigrationID("step", source.ID)
		rootAttemptID = collaborationTaskMigrationID("attempt", source.ID)
		step := ExecutionStep{
			StepID:            rootStepID,
			TaskID:            taskID,
			AgentID:           "legacy-collaboration",
			Role:              "executor",
			Description:       firstMigrationValue(source.Description, source.Title),
			Status:            int32(fallbackStatus),
			Attempt:           1,
			AttemptID:         rootAttemptID,
			EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
			StartedAt:         normalizedMigrationTime(source.StartedAt, source.CreatedAt),
			EndedAt:           collaborationTaskMigrationEndedAt(source),
		}
		if err := ensureCollaborationMigrationStep(tx, &step); err != nil {
			return "", "", err
		}
	}
	return rootStepID, rootAttemptID, nil
}

func ensureCollaborationMigrationStep(tx *gorm.DB, step *ExecutionStep) error {
	var existing collaborationMigrationStepIdentity
	err := tx.Model(&ExecutionStep{}).
		Select("step_id", "task_id", "attempt_id").
		Where("step_id = ?", step.StepID).
		First(&existing).Error
	if err == nil {
		if existing.TaskID != step.TaskID {
			return fmt.Errorf("CollaborationTask migration ExecutionStep identity %s collides", step.StepID)
		}
		if strings.TrimSpace(existing.AttemptID) == "" {
			return tx.Model(&ExecutionStep{}).
				Where("step_id = ?", step.StepID).
				Update("attempt_id", step.AttemptID).Error
		}
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect CollaborationTask migration ExecutionStep %s: %w", step.StepID, err)
	}
	if err := tx.Create(step).Error; err != nil {
		return fmt.Errorf("create migrated CollaborationTask ExecutionStep %s: %w", step.StepID, err)
	}
	return nil
}

type collaborationMigrationStepIdentity struct {
	StepID    string
	TaskID    string
	AttemptID string
}

func firstCollaborationMigrationStep(
	tx *gorm.DB,
	taskID string,
) (collaborationMigrationStepIdentity, bool, error) {
	var step collaborationMigrationStepIdentity
	err := tx.Model(&ExecutionStep{}).
		Select("step_id", "task_id", "attempt_id").
		Where("task_id = ?", strings.TrimSpace(taskID)).
		Order("started_at ASC, step_id ASC").
		First(&step).Error
	if err == gorm.ErrRecordNotFound {
		return collaborationMigrationStepIdentity{}, false, nil
	}
	if err != nil {
		return collaborationMigrationStepIdentity{}, false, fmt.Errorf("inspect CollaborationTask root step %s: %w", taskID, err)
	}
	return step, true, nil
}

func collaborationMigrationAttemptID(taskID string, stepID string, existingAttemptID string) string {
	if attemptID := strings.TrimSpace(existingAttemptID); attemptID != "" {
		return attemptID
	}
	return collaborationTaskMigrationID("attempt", taskID+"\x00"+stepID)
}

func upsertCollaborationTaskGoalMap(tx *gorm.DB, mapping *CollaborationTaskGoalMap) error {
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "legacy_task_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"owner_ptid",
			"goal_id",
			"task_id",
			"goal_node_id",
			"root_step_id",
			"root_attempt_id",
			"state",
			"block_reason",
			"source_status",
			"source_updated_at",
			"updated_at",
		}),
	}).Create(mapping).Error
}

func decodeCollaborationMigrationMeta(raw string) (map[string]string, error) {
	meta := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return meta, nil
	}
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return nil, err
	}
	return meta, nil
}

func mergeCollaborationMigrationTaskMeta(
	raw string,
	legacyTaskID string,
	ids collaborationTaskCanonicalIDs,
	rootStepID string,
) (string, error) {
	meta, err := decodeCollaborationMigrationMeta(raw)
	if err != nil {
		meta = map[string]string{}
	}
	meta["goal_id"] = ids.goalID
	meta["goal_node_id"] = ids.goalNodeID
	meta["legacy_collaboration_task_id"] = legacyTaskID
	meta["migration_state"] = CollaborationTaskMigrationStateMigrated
	meta["root_step_id"] = rootStepID
	encoded, err := json.Marshal(meta)
	return string(encoded), err
}

func collaborationMigrationBudget(source *CollaborationTask) []byte {
	encoded, err := json.Marshal(map[string]interface{}{
		"money":   source.BudgetMoney,
		"time_ms": source.BudgetTimeMs,
		"tokens":  source.BudgetTokens,
	})
	if err != nil {
		return []byte("{}")
	}
	return encoded
}

func collaborationMigrationSourceTime(source *CollaborationTask) time.Time {
	return normalizedMigrationTime(source.EndedAt, source.StartedAt, source.CreatedAt)
}

func collaborationTaskMigrationEndedAt(source *CollaborationTask) *time.Time {
	switch model.CollaborationTaskStatus(source.Status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		endedAt := normalizedMigrationTime(source.EndedAt, source.StartedAt, source.CreatedAt)
		return &endedAt
	default:
		return nil
	}
}

func collaborationNodeMigrationEndedAt(node *CollaborationTaskNode) *time.Time {
	switch model.TaskNodeStatus(node.Status) {
	case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
		model.TaskNodeStatus_TASK_NODE_STATUS_FAILED,
		model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED:
		endedAt := normalizedMigrationTime(node.EndedAt, node.StartedAt)
		return &endedAt
	default:
		return nil
	}
}
