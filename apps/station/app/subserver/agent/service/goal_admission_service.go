package service

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

const (
	goalAdmitCommand = "admit_agent_goal"
	goalStartCommand = "start_agent_goal"

	maxGoalParallelTasks = 64
)

type goalAdmissionPayload struct {
	GoalID           string `json:"goal_id"`
	ExpectedRevision uint64 `json:"expected_revision"`
}

type GoalAdmissionService struct {
	goals      *GoalService
	executions *GoalExecutionService
	starter    goalExecutionStarter
}

type goalExecutionStarter interface {
	PrepareTx(
		context.Context,
		*gorm.DB,
		*persistence.AgentGoal,
		*GoalExecutionSnapshot,
	) error
	Start(ownerPTID string, taskID string)
}

func NewGoalAdmissionService(
	goals *GoalService,
	executions ...*GoalExecutionService,
) *GoalAdmissionService {
	service := &GoalAdmissionService{goals: goals}
	if len(executions) > 0 {
		service.executions = executions[0]
	} else if goals != nil {
		service.executions = NewGoalExecutionService(goals.db)
	}
	return service
}

func (s *GoalAdmissionService) SetExecutionStarter(
	starter goalExecutionStarter,
) {
	if s == nil {
		return
	}
	s.starter = starter
}

func (s *GoalAdmissionService) Admit(
	ctx context.Context,
	ownerPTID string,
	req *model.AdmitAgentGoalRequest,
) (*model.AgentGoal, error) {
	if s == nil || s.goals == nil {
		return nil, goalInternal("Goal admission is unavailable", nil)
	}
	if err := validateGoalMutationInput(s.goals, ownerPTID, req); err != nil {
		return nil, err
	}
	payload := goalAdmissionPayload{
		GoalID:           strings.TrimSpace(req.GetGoalId()),
		ExpectedRevision: req.GetExpectedRevision(),
	}
	return s.goals.runGoalMutation(
		ctx,
		strings.TrimSpace(ownerPTID),
		payload.GoalID,
		payload.ExpectedRevision,
		goalAdmitCommand,
		strings.TrimSpace(req.GetIdempotencyKey()),
		goalPayloadHash(payload),
		func(record *persistence.AgentGoal) error {
			if model.AgentGoalStatus(record.Status) !=
				model.AgentGoalStatus_AGENT_GOAL_STATUS_REVIEWING {
				return goalInvalidState(
					record.GoalID,
					"Only a reviewed Goal can be admitted",
				)
			}
			if err := validateReviewedGoalAdmission(record); err != nil {
				return err
			}
			record.Status = int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_READY)
			return nil
		},
	)
}

func (s *GoalAdmissionService) Start(
	ctx context.Context,
	ownerPTID string,
	req *model.StartAgentGoalRequest,
) (*model.AgentGoal, error) {
	if s == nil || s.goals == nil {
		return nil, goalInternal("Goal start is unavailable", nil)
	}
	if err := validateGoalMutationInput(s.goals, ownerPTID, req); err != nil {
		return nil, err
	}
	payload := goalAdmissionPayload{
		GoalID:           strings.TrimSpace(req.GetGoalId()),
		ExpectedRevision: req.GetExpectedRevision(),
	}
	startedTaskID := ""
	goal, err := s.goals.runGoalMutationTx(
		ctx,
		strings.TrimSpace(ownerPTID),
		payload.GoalID,
		payload.ExpectedRevision,
		goalStartCommand,
		strings.TrimSpace(req.GetIdempotencyKey()),
		goalPayloadHash(payload),
		func(tx *gorm.DB, record *persistence.AgentGoal) error {
			if model.AgentGoalStatus(record.Status) !=
				model.AgentGoalStatus_AGENT_GOAL_STATUS_READY {
				return goalInvalidState(
					record.GoalID,
					"Only an admitted Goal can start",
				)
			}
			if s.executions == nil {
				return goalInternal("Goal execution is unavailable", nil)
			}
			execution, err := s.executions.AllocateFirstTx(ctx, tx, record)
			if err != nil {
				return err
			}
			if s.starter != nil {
				if err := s.starter.PrepareTx(
					ctx,
					tx,
					record,
					execution,
				); err != nil {
					return err
				}
				startedTaskID = execution.Task.TaskID
			}
			record.Status = int32(model.AgentGoalStatus_AGENT_GOAL_STATUS_RUNNING)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	if s.starter != nil && startedTaskID != "" {
		s.starter.Start(strings.TrimSpace(ownerPTID), startedTaskID)
	}
	return goal, nil
}

func validateReviewedGoalAdmission(record *persistence.AgentGoal) error {
	goal, err := goalModel(record)
	if err != nil {
		return err
	}
	if strings.TrimSpace(goal.GetOutcome()) == "" {
		return goalAdmissionRejected(record.GoalID, "outcome_missing")
	}
	budget := goal.GetBudget()
	if budget == nil || budget.GetMaxTokens() == 0 {
		return goalAdmissionRejected(record.GoalID, "max_tokens_missing")
	}
	if budget.GetWallTimeMs() == 0 {
		return goalAdmissionRejected(record.GoalID, "wall_time_missing")
	}
	if budget.GetMaxParallelTasks() == 0 ||
		budget.GetMaxParallelTasks() > maxGoalParallelTasks {
		return goalAdmissionRejected(record.GoalID, "parallelism_invalid")
	}
	if len(goal.GetAcceptanceCriteria()) == 0 {
		return goalAdmissionRejected(record.GoalID, "acceptance_missing")
	}
	for _, criterion := range goal.GetAcceptanceCriteria() {
		if criterion.GetRequired() {
			return nil
		}
	}
	return goalAdmissionRejected(record.GoalID, "required_acceptance_missing")
}

func goalAdmissionRejected(goalID string, reasonCode string) error {
	return errcode.NewGoalAdmissionRejected(goalID, reasonCode)
}
