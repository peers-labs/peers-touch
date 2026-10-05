package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

type GoalExecutionSnapshot struct {
	Node                        *persistence.AgentGoalNode
	Task                        *persistence.TaskRun
	Step                        *persistence.ExecutionStep
	Result                      *GoalResultProjection
	CoordinatorLeaseGeneration  uint64
	CoordinatorDispatchSequence uint64
	GoalGraphRevision           uint64
}

type GoalExecutionService struct {
	db  *gorm.DB
	now func() time.Time
}

func NewGoalExecutionService(db *gorm.DB) *GoalExecutionService {
	return &GoalExecutionService{
		db:  db,
		now: time.Now,
	}
}

func (s *GoalExecutionService) AllocateFirstTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
) (*GoalExecutionSnapshot, error) {
	if s == nil || tx == nil || goal == nil {
		return nil, goalInternal("Allocate Goal execution", nil)
	}

	now := s.now().UTC()
	nodeID := stableGoalExecutionID("gnode", goal.GoalID)
	taskID := stableGoalExecutionID("task", goal.GoalID)
	stepID := stableGoalExecutionID("step", goal.GoalID)
	attemptID := stableGoalExecutionID("attempt", goal.GoalID)
	meta, err := json.Marshal(map[string]string{
		"attempt_id":   attemptID,
		"goal_id":      goal.GoalID,
		"goal_node_id": nodeID,
		"root_step_id": stepID,
	})
	if err != nil {
		return nil, goalInternal("Encode Goal TaskRun metadata", err)
	}

	node := &persistence.AgentGoalNode{
		GoalID:                  goal.GoalID,
		NodeID:                  nodeID,
		TaskID:                  taskID,
		Title:                   goal.Title,
		Description:             goal.Outcome,
		Status:                  int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		PrerequisiteNodeIDsJSON: "[]",
		Priority:                0,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	task := &persistence.TaskRun{
		TaskID:         taskID,
		Title:          goal.Title,
		Description:    goal.Outcome,
		Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING),
		OwnerActorPTID: goal.OwnerPTID,
		WorkspaceID:    goal.WorkspaceID,
		MetaJSON:       string(meta),
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
		GoalID:         goal.GoalID,
		GoalNodeID:     nodeID,
		RootStepID:     stepID,
	}
	step := &persistence.ExecutionStep{
		StepID:            stepID,
		TaskID:            taskID,
		Role:              "executor",
		Description:       goal.Outcome,
		Status:            int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		Attempt:           1,
		AttemptID:         attemptID,
		EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
		StartedAt:         now,
	}

	if err := tx.WithContext(ctx).Create(task).Error; err != nil {
		return nil, goalInternal("Create Goal TaskRun", err)
	}
	if err := tx.WithContext(ctx).Create(step).Error; err != nil {
		return nil, goalInternal("Create Goal ExecutionStep", err)
	}
	if err := tx.WithContext(ctx).Create(node).Error; err != nil {
		return nil, goalInternal("Create Goal node", err)
	}

	goal.GraphRevision++
	return &GoalExecutionSnapshot{Node: node, Task: task, Step: step}, nil
}

func (s *GoalExecutionService) AllocateContinuationTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	prerequisiteNodeID string,
) (*GoalExecutionSnapshot, error) {
	if s == nil || tx == nil || goal == nil {
		return nil, goalInternal("Allocate Goal continuation", nil)
	}
	prerequisiteNodeID = strings.TrimSpace(prerequisiteNodeID)
	if prerequisiteNodeID == "" {
		return nil, goalInvalid("Goal continuation prerequisite node is required")
	}

	identitySeed := goal.GoalID + "\x00continuation"
	nodeID := stableGoalExecutionID("gnode", identitySeed)
	taskID := stableGoalExecutionID("task", identitySeed)
	stepID := stableGoalExecutionID("step", identitySeed)
	attemptID := stableGoalExecutionID("attempt", identitySeed)
	var existing persistence.TaskRun
	result := tx.WithContext(ctx).
		Where(
			"task_id = ? AND goal_id = ? AND goal_node_id = ?",
			taskID,
			goal.GoalID,
			nodeID,
		).
		Limit(1).
		Find(&existing)
	if result.Error != nil {
		return nil, goalInternal("Inspect Goal continuation", result.Error)
	}
	if result.RowsAffected == 1 {
		return loadGoalExecutionSnapshotTx(tx.WithContext(ctx), &existing)
	}

	prerequisitesJSON, err := json.Marshal([]string{prerequisiteNodeID})
	if err != nil {
		return nil, goalInternal("Encode Goal continuation prerequisites", err)
	}
	meta, err := json.Marshal(map[string]string{
		"attempt_id":           attemptID,
		"goal_id":              goal.GoalID,
		"goal_node_id":         nodeID,
		"goal_phase":           "continuation",
		"prerequisite_node_id": prerequisiteNodeID,
		"root_step_id":         stepID,
	})
	if err != nil {
		return nil, goalInternal("Encode Goal continuation metadata", err)
	}

	now := s.now().UTC()
	title := "Finalize: " + strings.TrimSpace(goal.Title)
	description := "Consolidate completed Goal work into the requested outcome: " +
		strings.TrimSpace(goal.Outcome)
	node := &persistence.AgentGoalNode{
		GoalID:                  goal.GoalID,
		NodeID:                  nodeID,
		TaskID:                  taskID,
		Title:                   title,
		Description:             description,
		Status:                  int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		PrerequisiteNodeIDsJSON: string(prerequisitesJSON),
		Priority:                -1,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	task := &persistence.TaskRun{
		TaskID:         taskID,
		Title:          title,
		Description:    description,
		Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING),
		OwnerActorPTID: goal.OwnerPTID,
		WorkspaceID:    goal.WorkspaceID,
		MetaJSON:       string(meta),
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
		GoalID:         goal.GoalID,
		GoalNodeID:     nodeID,
		RootStepID:     stepID,
	}
	step := &persistence.ExecutionStep{
		StepID:            stepID,
		TaskID:            taskID,
		Role:              "executor",
		Description:       description,
		Status:            int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		Attempt:           1,
		AttemptID:         attemptID,
		EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
		StartedAt:         now,
	}
	if err := tx.WithContext(ctx).Create(task).Error; err != nil {
		return nil, goalInternal("Create Goal continuation TaskRun", err)
	}
	if err := tx.WithContext(ctx).Create(step).Error; err != nil {
		return nil, goalInternal("Create Goal continuation ExecutionStep", err)
	}
	if err := tx.WithContext(ctx).Create(node).Error; err != nil {
		return nil, goalInternal("Create Goal continuation node", err)
	}

	goal.GraphRevision++
	return &GoalExecutionSnapshot{Node: node, Task: task, Step: step}, nil
}

func (s *GoalExecutionService) ListForOwner(
	ctx context.Context,
	ownerPTID string,
	limit int,
) ([]*GoalExecutionSnapshot, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	if s == nil || s.db == nil {
		return nil, goalInternal("Goal execution persistence is unavailable", nil)
	}
	if ownerPTID == "" {
		return nil, goalUnauthorized()
	}
	if limit <= 0 {
		limit = 20
	}

	var tasks []persistence.TaskRun
	if err := s.db.WithContext(ctx).
		Where("owner_actor_ptid = ? AND goal_id <> ''", ownerPTID).
		Order("updated_at DESC").
		Limit(limit).
		Find(&tasks).Error; err != nil {
		return nil, goalInternal("List Goal TaskRuns", err)
	}

	snapshots := make([]*GoalExecutionSnapshot, 0, len(tasks))
	for i := range tasks {
		snapshot, err := loadGoalExecutionSnapshotTx(
			s.db.WithContext(ctx),
			&tasks[i],
		)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func (s *GoalExecutionService) ListTaskRunsForOwner(
	ctx context.Context,
	ownerPTID string,
	limit int,
) ([]*GoalExecutionSnapshot, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	if s == nil || s.db == nil {
		return nil, goalInternal("TaskRun persistence is unavailable", nil)
	}
	if ownerPTID == "" {
		return nil, goalUnauthorized()
	}
	if limit <= 0 {
		limit = 20
	}

	var tasks []persistence.TaskRun
	if err := s.db.WithContext(ctx).
		Where(
			"owner_actor_ptid = ? AND surface <> ?",
			ownerPTID,
			int32(model.TaskSurface_TASK_SURFACE_CHAT),
		).
		Order("updated_at DESC").
		Limit(limit).
		Find(&tasks).Error; err != nil {
		return nil, goalInternal("List TaskRuns", err)
	}

	snapshots := make([]*GoalExecutionSnapshot, 0, len(tasks))
	for i := range tasks {
		snapshot, err := loadTaskRunSnapshotTx(
			s.db.WithContext(ctx),
			&tasks[i],
		)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func (s *GoalExecutionService) GetForOwner(
	ctx context.Context,
	ownerPTID string,
	taskID string,
) (*GoalExecutionSnapshot, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	taskID = strings.TrimSpace(taskID)
	if s == nil || s.db == nil {
		return nil, goalInternal("Goal execution persistence is unavailable", nil)
	}
	if ownerPTID == "" {
		return nil, goalUnauthorized()
	}
	if taskID == "" {
		return nil, goalInvalid("task_id is required")
	}

	var task persistence.TaskRun
	if err := s.db.WithContext(ctx).
		Where("task_id = ? AND owner_actor_ptid = ? AND goal_id <> ''", taskID, ownerPTID).
		First(&task).Error; err != nil {
		return nil, goalRecordError("Goal TaskRun", taskID, err)
	}
	return loadGoalExecutionSnapshotTx(s.db.WithContext(ctx), &task)
}

func loadGoalExecutionSnapshotTx(
	tx *gorm.DB,
	task *persistence.TaskRun,
) (*GoalExecutionSnapshot, error) {
	snapshot, err := loadTaskRunSnapshotTx(tx, task)
	if err != nil {
		return nil, err
	}
	if snapshot.Node == nil {
		return nil, goalRecordError("Goal node", task.GoalNodeID, gorm.ErrRecordNotFound)
	}
	return snapshot, nil
}

func loadTaskRunSnapshotTx(
	tx *gorm.DB,
	task *persistence.TaskRun,
) (*GoalExecutionSnapshot, error) {
	var node *persistence.AgentGoalNode
	if strings.TrimSpace(task.GoalID) != "" &&
		strings.TrimSpace(task.GoalNodeID) != "" {
		var record persistence.AgentGoalNode
		if err := tx.Where(
			"goal_id = ? AND node_id = ? AND task_id = ?",
			task.GoalID,
			task.GoalNodeID,
			task.TaskID,
		).First(&record).Error; err != nil {
			return nil, goalRecordError("Goal node", task.GoalNodeID, err)
		}
		node = &record
	}

	var step persistence.ExecutionStep
	if err := tx.Where(
		"task_id = ? AND step_id = ?",
		task.TaskID,
		task.RootStepID,
	).First(&step).Error; err != nil {
		return nil, goalRecordError("Goal ExecutionStep", task.RootStepID, err)
	}
	var result *GoalResultProjection
	if node != nil {
		var err error
		result, err = loadGoalResultProjectionTx(tx, task, &step)
		if err != nil {
			return nil, goalInternal("Load Goal result projection", err)
		}
	}
	return &GoalExecutionSnapshot{
		Node:   node,
		Task:   task,
		Step:   &step,
		Result: result,
	}, nil
}

func stableGoalExecutionID(prefix string, goalID string) string {
	sum := sha256.Sum256([]byte("goal-execution-v1\x00" + goalID + "\x00" + prefix))
	return prefix + "_" + hex.EncodeToString(sum[:12])
}
