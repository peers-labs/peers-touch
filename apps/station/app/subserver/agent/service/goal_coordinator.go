package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultGoalCoordinatorLeaseTTL = 30 * time.Second
	maxGoalReadyFrontier           = 64
	goalFrontierAdvancedEvent      = "agent.goal.frontier.advanced"
	goalCoordinatorLeaseCancelled  = "cancelled"
)

type goalCoordinatorDispatcher interface {
	PrepareTx(
		context.Context,
		*gorm.DB,
		*persistence.AgentGoal,
		*GoalExecutionSnapshot,
	) error
	IsPreparedTx(
		context.Context,
		*gorm.DB,
		*GoalExecutionSnapshot,
	) (bool, error)
	Start(ownerPTID string, taskID string)
	Cancel(ownerPTID string, taskID string) error
}

type GoalCoordinatorAdvanceResult struct {
	GoalID            string
	LeaseOwned        bool
	LeaseGeneration   uint64
	GraphRevision     uint64
	DispatchSequence  uint64
	ReconciledTaskIDs []string
	DispatchedTaskIDs []string
}

// GoalCoordinator is the single Station owner for Goal frontier selection.
// Runtime adapters prepare and execute TaskRuns but cannot advance the graph.
type GoalCoordinator struct {
	db            *gorm.DB
	executions    *GoalExecutionService
	dispatcher    goalCoordinatorDispatcher
	coordinatorID string
	now           func() time.Time
	leaseTTL      time.Duration
}

func NewGoalCoordinator(
	db *gorm.DB,
	executions *GoalExecutionService,
	dispatcher goalCoordinatorDispatcher,
) *GoalCoordinator {
	return &GoalCoordinator{
		db:            db,
		executions:    executions,
		dispatcher:    dispatcher,
		coordinatorID: generateID("goal_coordinator"),
		now:           func() time.Time { return time.Now().UTC() },
		leaseTTL:      defaultGoalCoordinatorLeaseTTL,
	}
}

// PrepareTx acquires the Goal scheduling lease and prepares the initial node.
func (c *GoalCoordinator) PrepareTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	execution *GoalExecutionSnapshot,
) error {
	if c == nil || tx == nil || goal == nil || execution == nil ||
		execution.Node == nil || execution.Task == nil || execution.Step == nil ||
		c.dispatcher == nil {
		return goalInternal("Prepare Goal coordinator", nil)
	}

	leaseGoal := *goal
	leaseGoal.Revision++
	lease, owned, err := c.acquireLeaseTx(ctx, tx, &leaseGoal, c.now().UTC())
	if err != nil {
		return err
	}
	if !owned {
		return goalInternal("Goal coordinator lease is already owned", nil)
	}
	lease.DispatchSequence++
	if err := bindGoalCoordinatorDispatchTx(
		ctx,
		tx,
		execution,
		lease,
	); err != nil {
		return err
	}
	if err := c.dispatcher.PrepareTx(ctx, tx, goal, execution); err != nil {
		return err
	}
	return c.updateLeaseTx(ctx, tx, lease, c.now().UTC())
}

func (c *GoalCoordinator) Start(ownerPTID string, taskID string) {
	if c == nil || c.dispatcher == nil {
		return
	}
	c.dispatcher.Start(ownerPTID, taskID)
}

func (c *GoalCoordinator) Cancel(
	ownerPTID string,
	taskIDs []string,
) error {
	if c == nil || c.dispatcher == nil {
		return goalInternal("Goal coordinator cancellation is unavailable", nil)
	}
	var firstErr error
	for _, taskID := range uniqueGoalCoordinatorTaskIDs(taskIDs) {
		if err := c.dispatcher.Cancel(ownerPTID, taskID); err != nil &&
			firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (c *GoalCoordinator) OnTaskTerminal(
	ctx context.Context,
	ownerPTID string,
	goalID string,
) error {
	_, err := c.Advance(ctx, ownerPTID, goalID)
	return err
}

// Advance reconciles all in-flight TaskRuns before selecting a deterministic,
// dependency-ready frontier bounded by the Goal's maximum parallelism.
func (c *GoalCoordinator) Advance(
	ctx context.Context,
	ownerPTID string,
	goalID string,
) (*GoalCoordinatorAdvanceResult, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	goalID = strings.TrimSpace(goalID)
	if c == nil || c.db == nil || c.executions == nil || c.dispatcher == nil {
		return nil, goalInternal("Goal coordinator is unavailable", nil)
	}
	if ownerPTID == "" {
		return nil, goalUnauthorized()
	}
	if goalID == "" {
		return nil, goalInvalid("goal_id is required")
	}

	result := &GoalCoordinatorAdvanceResult{GoalID: goalID}
	startTaskIDs := make([]string, 0)
	err := c.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		goal, err := loadOwnedGoalTx(tx, ownerPTID, goalID)
		if err != nil {
			return err
		}
		if model.AgentGoalStatus(goal.Status) !=
			model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING {
			return nil
		}

		now := c.now().UTC()
		lease, owned, err := c.acquireLeaseTx(ctx, tx, goal, now)
		if err != nil {
			return err
		}
		result.LeaseOwned = owned
		result.LeaseGeneration = lease.Generation
		result.GraphRevision = lease.GraphRevision
		result.DispatchSequence = lease.DispatchSequence
		if !owned {
			return nil
		}

		nodes, executions, prepared, err := c.loadGraphTx(ctx, tx, goal)
		if err != nil {
			return err
		}
		if shouldCreateDefaultGoalContinuation(nodes, lease.DispatchSequence) {
			continuation, allocateErr := c.executions.AllocateContinuationTx(
				ctx,
				tx,
				goal,
				nodes[0].NodeID,
			)
			if allocateErr != nil {
				return allocateErr
			}
			previousRevision := goal.Revision
			goal.Revision++
			goal.UpdatedAt = now
			update := tx.WithContext(ctx).
				Model(&persistence.AgentGoal{}).
				Where(
					"goal_id = ? AND revision = ?",
					goal.GoalID,
					previousRevision,
				).
				Updates(map[string]any{
					"revision":       goal.Revision,
					"graph_revision": goal.GraphRevision,
					"updated_at":     goal.UpdatedAt,
				})
			if update.Error != nil {
				return goalInternal("Advance Goal graph revision", update.Error)
			}
			if update.RowsAffected != 1 {
				return goalRevisionConflictTx(
					tx,
					goal.GoalID,
					previousRevision,
				)
			}
			if err := NewGoalService(c.db).appendGoalEventTx(
				ctx,
				tx,
				goal,
				goalFrontierAdvancedEvent,
				persistence.AgentRealtimeClassProgress,
			); err != nil {
				return err
			}
			lease.GoalRevision = goal.Revision
			lease.GraphRevision = goal.GraphRevision
			nodes = append(nodes, *continuation.Node)
			sort.SliceStable(nodes, func(i, j int) bool {
				if nodes[i].Priority != nodes[j].Priority {
					return nodes[i].Priority > nodes[j].Priority
				}
				return nodes[i].NodeID < nodes[j].NodeID
			})
			executions[continuation.Node.NodeID] = continuation
			prepared[continuation.Node.NodeID] = false
			result.GraphRevision = goal.GraphRevision
		}
		statusByNodeID := make(map[string]model.TaskNodeStatus, len(nodes))
		active := 0
		for index := range nodes {
			node := &nodes[index]
			statusByNodeID[node.NodeID] = model.TaskNodeStatus(node.Status)
			execution := executions[node.NodeID]
			if execution == nil {
				return goalInternal(
					fmt.Sprintf("Goal node %s has no preallocated execution", node.NodeID),
					nil,
				)
			}
			taskStatus := model.CollaborationTaskStatus(execution.Task.Status)
			if taskStatus ==
				model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING ||
				(taskStatus ==
					model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING &&
					prepared[node.NodeID]) {
				active++
				result.ReconciledTaskIDs = append(
					result.ReconciledTaskIDs,
					execution.Task.TaskID,
				)
				if taskStatus ==
					model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING {
					startTaskIDs = append(startTaskIDs, execution.Task.TaskID)
				}
			}
		}

		maxParallel, err := goalCoordinatorMaxParallel(goal)
		if err != nil {
			return err
		}
		capacity := maxParallel - active
		if capacity <= 0 {
			return c.updateLeaseTx(ctx, tx, lease, now)
		}

		for index := range nodes {
			if capacity == 0 {
				break
			}
			node := &nodes[index]
			if model.TaskNodeStatus(node.Status) !=
				model.TaskNodeStatus_TASK_NODE_STATUS_PENDING ||
				prepared[node.NodeID] {
				continue
			}
			ready, err := goalNodeDependenciesCompleted(node, statusByNodeID)
			if err != nil {
				return err
			}
			if !ready {
				continue
			}
			execution := executions[node.NodeID]
			lease.DispatchSequence++
			if err := bindGoalCoordinatorDispatchTx(
				ctx,
				tx,
				execution,
				lease,
			); err != nil {
				return err
			}
			if err := c.dispatcher.PrepareTx(ctx, tx, goal, execution); err != nil {
				return err
			}
			prepared[node.NodeID] = true
			result.DispatchedTaskIDs = append(
				result.DispatchedTaskIDs,
				execution.Task.TaskID,
			)
			startTaskIDs = append(startTaskIDs, execution.Task.TaskID)
			capacity--
		}
		result.DispatchSequence = lease.DispatchSequence
		return c.updateLeaseTx(ctx, tx, lease, now)
	})
	if err != nil {
		return nil, err
	}

	for _, taskID := range uniqueGoalCoordinatorTaskIDs(startTaskIDs) {
		c.dispatcher.Start(ownerPTID, taskID)
	}
	return result, nil
}

func (c *GoalCoordinator) loadGraphTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
) (
	[]persistence.AgentGoalNode,
	map[string]*GoalExecutionSnapshot,
	map[string]bool,
	error,
) {
	var nodes []persistence.AgentGoalNode
	if err := tx.WithContext(ctx).
		Where("goal_id = ?", goal.GoalID).
		Order("priority DESC, node_id ASC").
		Limit(maxGoalReadyFrontier + 1).
		Find(&nodes).Error; err != nil {
		return nil, nil, nil, goalInternal("Load Goal ready frontier", err)
	}
	if len(nodes) > maxGoalReadyFrontier {
		return nil, nil, nil, goalAdmissionRejected(
			goal.GoalID,
			"ready_frontier_limit",
		)
	}

	executions := make(map[string]*GoalExecutionSnapshot, len(nodes))
	prepared := make(map[string]bool, len(nodes))
	for index := range nodes {
		node := &nodes[index]
		var task persistence.TaskRun
		if err := tx.WithContext(ctx).
			Where(
				"task_id = ? AND goal_id = ? AND goal_node_id = ?",
				node.TaskID,
				goal.GoalID,
				node.NodeID,
			).
			First(&task).Error; err != nil {
			return nil, nil, nil, goalRecordError(
				"Goal TaskRun",
				node.TaskID,
				err,
			)
		}
		var step persistence.ExecutionStep
		if err := tx.WithContext(ctx).
			Where(
				"task_id = ? AND step_id = ?",
				task.TaskID,
				task.RootStepID,
			).
			First(&step).Error; err != nil {
			return nil, nil, nil, goalRecordError(
				"Goal ExecutionStep",
				task.RootStepID,
				err,
			)
		}
		execution := &GoalExecutionSnapshot{
			Node: node,
			Task: &task,
			Step: &step,
		}
		isPrepared, err := c.dispatcher.IsPreparedTx(ctx, tx, execution)
		if err != nil {
			return nil, nil, nil, goalInternal(
				"Inspect Goal node dispatch",
				err,
			)
		}
		executions[node.NodeID] = execution
		prepared[node.NodeID] = isPrepared
	}
	return nodes, executions, prepared, nil
}

func (c *GoalCoordinator) acquireLeaseTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	now time.Time,
) (*persistence.GoalCoordinatorLease, bool, error) {
	var lease persistence.GoalCoordinatorLease
	err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("goal_id = ?", goal.GoalID).
		First(&lease).Error
	if err == gorm.ErrRecordNotFound {
		lease = persistence.GoalCoordinatorLease{
			GoalID:           goal.GoalID,
			OwnerID:          c.coordinatorID,
			Generation:       1,
			GoalRevision:     goal.Revision,
			GraphRevision:    goal.GraphRevision,
			DispatchSequence: 0,
			Status:           persistence.GoalCoordinatorLeaseActive,
			AcquiredAt:       now,
			HeartbeatAt:      now,
			ExpiresAt:        now.Add(c.leaseTTL),
			UpdatedAt:        now,
		}
		if err := tx.WithContext(ctx).Create(&lease).Error; err != nil {
			return nil, false, goalInternal("Acquire Goal coordinator lease", err)
		}
		return &lease, true, nil
	}
	if err != nil {
		return nil, false, goalInternal("Load Goal coordinator lease", err)
	}

	if lease.OwnerID != c.coordinatorID && lease.ExpiresAt.After(now) {
		return &lease, false, nil
	}
	previousGeneration := lease.Generation
	expired := !lease.ExpiresAt.After(now)
	if expired {
		lease.Generation++
		lease.AcquiredAt = now
	}
	lease.OwnerID = c.coordinatorID
	lease.GoalRevision = goal.Revision
	lease.GraphRevision = goal.GraphRevision
	lease.Status = persistence.GoalCoordinatorLeaseActive
	lease.HeartbeatAt = now
	lease.ExpiresAt = now.Add(c.leaseTTL)
	lease.UpdatedAt = now

	result := tx.WithContext(ctx).
		Model(&persistence.GoalCoordinatorLease{}).
		Where(
			"goal_id = ? AND generation = ?",
			lease.GoalID,
			previousGeneration,
		).
		Updates(map[string]any{
			"owner_id":       lease.OwnerID,
			"generation":     lease.Generation,
			"goal_revision":  lease.GoalRevision,
			"graph_revision": lease.GraphRevision,
			"status":         lease.Status,
			"acquired_at":    lease.AcquiredAt,
			"heartbeat_at":   lease.HeartbeatAt,
			"expires_at":     lease.ExpiresAt,
			"updated_at":     lease.UpdatedAt,
		})
	if result.Error != nil {
		return nil, false, goalInternal("Renew Goal coordinator lease", result.Error)
	}
	if result.RowsAffected != 1 {
		return &lease, false, nil
	}
	return &lease, true, nil
}

func (c *GoalCoordinator) updateLeaseTx(
	ctx context.Context,
	tx *gorm.DB,
	lease *persistence.GoalCoordinatorLease,
	now time.Time,
) error {
	lease.HeartbeatAt = now
	lease.ExpiresAt = now.Add(c.leaseTTL)
	lease.UpdatedAt = now
	result := tx.WithContext(ctx).
		Model(&persistence.GoalCoordinatorLease{}).
		Where(
			"goal_id = ? AND owner_id = ? AND generation = ?",
			lease.GoalID,
			lease.OwnerID,
			lease.Generation,
		).
		Updates(map[string]any{
			"goal_revision":     lease.GoalRevision,
			"graph_revision":    lease.GraphRevision,
			"dispatch_sequence": lease.DispatchSequence,
			"status":            lease.Status,
			"heartbeat_at":      lease.HeartbeatAt,
			"expires_at":        lease.ExpiresAt,
			"updated_at":        lease.UpdatedAt,
		})
	if result.Error != nil {
		return goalInternal("Update Goal coordinator lease", result.Error)
	}
	if result.RowsAffected != 1 {
		return goalInternal("Goal coordinator lost its lease", nil)
	}
	return nil
}

func fenceGoalCoordinatorCancellationTx(
	ctx context.Context,
	tx *gorm.DB,
	goalID string,
	goalRevision uint64,
	now time.Time,
) error {
	update := tx.WithContext(ctx).
		Model(&persistence.GoalCoordinatorLease{}).
		Where("goal_id = ?", strings.TrimSpace(goalID)).
		Updates(map[string]any{
			"generation":    gorm.Expr("generation + 1"),
			"goal_revision": goalRevision,
			"status":        goalCoordinatorLeaseCancelled,
			"heartbeat_at":  now,
			"expires_at":    now,
			"updated_at":    now,
		})
	if update.Error != nil {
		return goalInternal("Fence Goal coordinator cancellation", update.Error)
	}
	return nil
}

func goalCoordinatorMaxParallel(goal *persistence.AgentGoal) (int, error) {
	var budget model.AgentGoalBudget
	if err := json.Unmarshal(goal.BudgetJSON, &budget); err != nil {
		return 0, goalInternal("Decode Goal coordinator budget", err)
	}
	maxParallel := int(budget.GetMaxParallelTasks())
	if maxParallel <= 0 || maxParallel > maxGoalReadyFrontier {
		return 0, goalAdmissionRejected(goal.GoalID, "parallelism_invalid")
	}
	return maxParallel, nil
}

func goalNodeDependenciesCompleted(
	node *persistence.AgentGoalNode,
	statusByNodeID map[string]model.TaskNodeStatus,
) (bool, error) {
	var prerequisiteNodeIDs []string
	if err := json.Unmarshal(
		[]byte(node.PrerequisiteNodeIDsJSON),
		&prerequisiteNodeIDs,
	); err != nil {
		return false, goalInternal(
			"Decode Goal node prerequisites",
			err,
		)
	}
	sort.Strings(prerequisiteNodeIDs)
	for _, prerequisiteNodeID := range prerequisiteNodeIDs {
		status, exists := statusByNodeID[strings.TrimSpace(prerequisiteNodeID)]
		if !exists ||
			status != model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED {
			return false, nil
		}
	}
	return true, nil
}

func shouldCreateDefaultGoalContinuation(
	nodes []persistence.AgentGoalNode,
	dispatchSequence uint64,
) bool {
	return len(nodes) == 1 &&
		dispatchSequence == 1 &&
		model.TaskNodeStatus(nodes[0].Status) ==
			model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED
}

func uniqueGoalCoordinatorTaskIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func bindGoalCoordinatorDispatchTx(
	ctx context.Context,
	tx *gorm.DB,
	execution *GoalExecutionSnapshot,
	lease *persistence.GoalCoordinatorLease,
) error {
	if execution == nil || execution.Task == nil || lease == nil {
		return goalInternal("Bind Goal coordinator dispatch", nil)
	}
	meta := make(map[string]string)
	if raw := strings.TrimSpace(execution.Task.MetaJSON); raw != "" {
		if err := json.Unmarshal([]byte(raw), &meta); err != nil {
			return goalInternal("Decode Goal TaskRun coordinator metadata", err)
		}
	}
	meta["coordinator_dispatch_sequence"] = strconv.FormatUint(
		lease.DispatchSequence,
		10,
	)
	meta["coordinator_lease_generation"] = strconv.FormatUint(
		lease.Generation,
		10,
	)
	meta["goal_graph_revision"] = strconv.FormatUint(
		lease.GraphRevision,
		10,
	)
	encoded, err := json.Marshal(meta)
	if err != nil {
		return goalInternal("Encode Goal TaskRun coordinator metadata", err)
	}
	execution.Task.MetaJSON = string(encoded)
	execution.CoordinatorLeaseGeneration = lease.Generation
	execution.CoordinatorDispatchSequence = lease.DispatchSequence
	execution.GoalGraphRevision = lease.GraphRevision
	if err := tx.WithContext(ctx).
		Model(&persistence.TaskRun{}).
		Where("task_id = ?", execution.Task.TaskID).
		Update("meta_json", execution.Task.MetaJSON).Error; err != nil {
		return goalInternal("Persist Goal TaskRun coordinator metadata", err)
	}
	return nil
}
