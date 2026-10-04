package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type GoalHandlers struct {
	service *service.GoalService
}

func NewGoalHandlers(goalService *service.GoalService) *GoalHandlers {
	return &GoalHandlers{service: goalService}
}

func (h *GoalHandlers) HandleCreate(
	ctx context.Context,
	req *model.CreateAgentGoalRequest,
) (*model.CreateAgentGoalResponse, error) {
	goal, err := h.service.CreateDraft(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateAgentGoalResponse{Goal: goal}, nil
}

func (h *GoalHandlers) HandleGet(
	ctx context.Context,
	req *model.GetAgentGoalRequest,
) (*model.GetAgentGoalResponse, error) {
	goal, err := h.service.Get(ctx, subjectActorPTID(ctx), req.GetGoalId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetAgentGoalResponse{Goal: goal}, nil
}

func (h *GoalHandlers) HandleUpdate(
	ctx context.Context,
	req *model.UpdateAgentGoalRequest,
) (*model.UpdateAgentGoalResponse, error) {
	goal, err := h.service.UpdateContract(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateAgentGoalResponse{Goal: goal}, nil
}

func (h *GoalHandlers) HandleReview(
	ctx context.Context,
	req *model.ReviewAgentGoalRequest,
) (*model.ReviewAgentGoalResponse, error) {
	goal, err := h.service.Review(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ReviewAgentGoalResponse{Goal: goal}, nil
}
