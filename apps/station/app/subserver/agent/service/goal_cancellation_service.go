package service

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"gorm.io/gorm"
)

const goalCancellationSummary = "Goal cancelled by user."

type goalExecutionCanceller interface {
	Cancel(ownerPTID string, taskIDs []string) error
}

// GoalCancellationService owns the durable-before-signal cancellation
// boundary for both pre-execution and active Goals.
type GoalCancellationService struct {
	goals     *GoalService
	canceller goalExecutionCanceller
}

func NewGoalCancellationService(
	goals *GoalService,
	canceller goalExecutionCanceller,
) *GoalCancellationService {
	return &GoalCancellationService{
		goals:     goals,
		canceller: canceller,
	}
}

func (s *GoalCancellationService) Cancel(
	ctx context.Context,
	ownerPTID string,
	req *model.CancelAgentGoalRequest,
) (*model.AgentGoal, error) {
	ownerPTID = strings.TrimSpace(ownerPTID)
	if s == nil || s.goals == nil {
		return nil, goalInternal("Goal cancellation is unavailable", nil)
	}
	if err := validateGoalMutationInput(s.goals, ownerPTID, req); err != nil {
		return nil, err
	}

	payload := goalCancelPayload{
		GoalID:           strings.TrimSpace(req.GetGoalId()),
		ExpectedRevision: req.GetExpectedRevision(),
	}
	var activeTaskIDs []string
	cancelled, err := s.goals.runGoalMutationTx(
		ctx,
		ownerPTID,
		payload.GoalID,
		payload.ExpectedRevision,
		goalCancelCommand,
		strings.TrimSpace(req.GetIdempotencyKey()),
		goalPayloadHash(payload),
		func(tx *gorm.DB, goal *persistence.AgentGoal) error {
			switch model.AgentGoalStatus(goal.Status) {
			case model.AgentGoalStatus_AGENT_GOAL_STATUS_DRAFT,
				model.AgentGoalStatus_AGENT_GOAL_STATUS_REVIEWING,
				model.AgentGoalStatus_AGENT_GOAL_STATUS_READY:
				goal.Status = int32(
					model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED,
				)
				return nil
			case model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING,
				model.AgentGoalStatus_AGENT_GOAL_STATUS_NEEDS_USER,
				model.AgentGoalStatus_AGENT_GOAL_STATUS_REPLANNING,
				model.AgentGoalStatus_AGENT_GOAL_STATUS_RECOVERING:
				var cancelErr error
				activeTaskIDs, cancelErr = cancelActiveGoalExecutionsTx(
					ctx,
					tx,
					goal,
					s.goals.now().UTC(),
				)
				if cancelErr != nil {
					return cancelErr
				}
				goal.Status = int32(
					model.AgentGoalStatus_AGENT_GOAL_STATUS_CANCELLED,
				)
				return nil
			default:
				return goalInvalidState(
					goal.GoalID,
					"Goal cannot be cancelled from its current state",
				)
			}
		},
	)
	if err != nil {
		return nil, err
	}

	if s.canceller != nil && len(activeTaskIDs) > 0 {
		if signalErr := s.canceller.Cancel(ownerPTID, activeTaskIDs); signalErr != nil {
			logger.Warnf(
				ctx,
				"Goal cancellation persisted but executor signalling failed: goal_id=%s actor_ptid=%s err=%v",
				payload.GoalID,
				ownerPTID,
				signalErr,
			)
		}
	}
	return cancelled, nil
}

func cancelActiveGoalExecutionsTx(
	ctx context.Context,
	tx *gorm.DB,
	goal *persistence.AgentGoal,
	now time.Time,
) ([]string, error) {
	if tx == nil || goal == nil {
		return nil, goalInternal("Cancel active Goal executions", nil)
	}

	var tasks []persistence.TaskRun
	if err := tx.WithContext(ctx).
		Where(
			"goal_id = ? AND owner_actor_ptid = ? AND status IN ?",
			goal.GoalID,
			goal.OwnerPTID,
			[]int32{
				int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING),
				int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
				int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
			},
		).
		Order("task_id ASC").
		Find(&tasks).Error; err != nil {
		return nil, goalInternal("Load active Goal TaskRuns", err)
	}

	taskIDs := make([]string, 0, len(tasks))
	for index := range tasks {
		taskIDs = append(taskIDs, tasks[index].TaskID)
	}
	if len(taskIDs) > 0 {
		if err := tx.WithContext(ctx).
			Model(&persistence.DirectRun{}).
			Where(
				"task_id IN ? AND state IN ?",
				taskIDs,
				[]string{"pending_station_provider_route", "running"},
			).
			Updates(map[string]any{
				"state":      "cancelled",
				"updated_at": now,
			}).Error; err != nil {
			return nil, goalInternal("Cancel Goal runtime attempts", err)
		}
		if err := tx.WithContext(ctx).
			Model(&persistence.TaskRun{}).
			Where(
				"task_id IN ? AND status IN ?",
				taskIDs,
				[]int32{
					int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING),
					int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
					int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
				},
			).
			Updates(map[string]any{
				"status": int32(
					model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED,
				),
				"updated_at": now,
				"ended_at":   &now,
			}).Error; err != nil {
			return nil, goalInternal("Cancel Goal TaskRuns", err)
		}
		if err := tx.WithContext(ctx).
			Model(&persistence.ExecutionStep{}).
			Where(
				"task_id IN ? AND status IN ?",
				taskIDs,
				[]int32{
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				},
			).
			Updates(map[string]any{
				"status": int32(
					model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED,
				),
				"result_summary": goalCancellationSummary,
				"ended_at":       &now,
			}).Error; err != nil {
			return nil, goalInternal("Cancel Goal execution steps", err)
		}
		if err := tx.WithContext(ctx).
			Model(&persistence.AgentGoalNode{}).
			Where(
				"goal_id = ? AND task_id IN ? AND status IN ?",
				goal.GoalID,
				taskIDs,
				[]int32{
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				},
			).
			Updates(map[string]any{
				"status": int32(
					model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED,
				),
				"updated_at": now,
			}).Error; err != nil {
			return nil, goalInternal("Cancel Goal graph nodes", err)
		}
	}
	if err := fenceGoalCoordinatorCancellationTx(
		ctx,
		tx,
		goal.GoalID,
		goal.Revision+1,
		now,
	); err != nil {
		return nil, err
	}
	return taskIDs, nil
}
