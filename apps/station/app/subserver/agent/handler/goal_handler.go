package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type GoalHandlers struct {
	service   *service.GoalService
	admission *service.GoalAdmissionService
}

func NewGoalHandlers(
	goalService *service.GoalService,
	admissionService *service.GoalAdmissionService,
) *GoalHandlers {
	return &GoalHandlers{
		service:   goalService,
		admission: admissionService,
	}
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

func (h *GoalHandlers) HandleAdmit(
	ctx context.Context,
	req *model.AdmitAgentGoalRequest,
) (*model.AdmitAgentGoalResponse, error) {
	goal, err := h.admission.Admit(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.AdmitAgentGoalResponse{Goal: goal}, nil
}

func (h *GoalHandlers) HandleStart(
	ctx context.Context,
	req *model.StartAgentGoalRequest,
) (*model.StartAgentGoalResponse, error) {
	goal, err := h.admission.Start(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.StartAgentGoalResponse{Goal: goal}, nil
}

func (h *GoalHandlers) HandleCancel(
	ctx context.Context,
	req *model.CancelAgentGoalRequest,
) (*model.CancelAgentGoalResponse, error) {
	goal, err := h.service.Cancel(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CancelAgentGoalResponse{Goal: goal}, nil
}
