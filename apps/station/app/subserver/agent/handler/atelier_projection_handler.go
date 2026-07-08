package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type AtelierProjectionHandlers struct {
	projectionService *service.AtelierProjectionService
}

func NewAtelierProjectionHandlers(projectionService *service.AtelierProjectionService) *AtelierProjectionHandlers {
	return &AtelierProjectionHandlers{projectionService: projectionService}
}

func (h *AtelierProjectionHandlers) HandleLoadWorkspace(
	ctx context.Context,
	req *service.LoadAtelierWorkspaceRequest,
) (*service.AtelierProjectionSnapshot, error) {
	snapshot, err := h.projectionService.LoadWorkspace(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return snapshot, nil
}

func (h *AtelierProjectionHandlers) HandleCreateProjectFromGoal(
	ctx context.Context,
	req *service.CreateAtelierProjectFromGoalRequest,
) (*service.AtelierProjectionSnapshot, error) {
	snapshot, err := h.projectionService.CreateProjectFromGoal(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return snapshot, nil
}

func (h *AtelierProjectionHandlers) HandleSendMessage(
	ctx context.Context,
	req *service.SendAtelierMessageRequest,
) (*service.AtelierProjectionSnapshot, error) {
	snapshot, err := h.projectionService.SendMessage(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return snapshot, nil
}

func (h *AtelierProjectionHandlers) HandleResolveDecision(
	ctx context.Context,
	req *service.ResolveAtelierDecisionRequest,
) (*service.AtelierProjectionSnapshot, error) {
	snapshot, err := h.projectionService.ResolveDecision(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return snapshot, nil
}

func (h *AtelierProjectionHandlers) HandleSetTaskStatus(
	ctx context.Context,
	req *service.SetAtelierTaskStatusRequest,
) (*service.AtelierProjectionSnapshot, error) {
	snapshot, err := h.projectionService.SetTaskStatus(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return snapshot, nil
}

func (h *AtelierProjectionHandlers) HandlePurgeTask(
	ctx context.Context,
	req *service.PurgeAtelierTaskRequest,
) (*service.AtelierProjectionSnapshot, error) {
	snapshot, err := h.projectionService.PurgeTask(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return snapshot, nil
}

func (h *AtelierProjectionHandlers) HandleProviderCapabilities(
	ctx context.Context,
	req *service.ListAtelierProviderCapabilitiesRequest,
) (*service.AtelierProviderCapabilitiesResponse, error) {
	response, err := h.projectionService.ProviderCapabilities(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *AtelierProjectionHandlers) HandleSubmitFeedback(
	ctx context.Context,
	req *service.SubmitAtelierFeedbackRequest,
) (*service.SubmitAtelierFeedbackResponse, error) {
	response, err := h.projectionService.SubmitFeedback(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *AtelierProjectionHandlers) HandleConfirmMemoryCandidate(
	ctx context.Context,
	req *service.ConfirmAtelierMemoryCandidateRequest,
) (*service.ConfirmAtelierMemoryCandidateResponse, error) {
	response, err := h.projectionService.ConfirmMemoryCandidate(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *AtelierProjectionHandlers) HandleConfirmRerun(
	ctx context.Context,
	req *service.ConfirmAtelierRerunRequest,
) (*service.ConfirmAtelierRerunResponse, error) {
	response, err := h.projectionService.ConfirmRerun(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *AtelierProjectionHandlers) HandleFetchArtifactBody(
	ctx context.Context,
	req *service.FetchAtelierArtifactBodyRequest,
) (*service.FetchAtelierArtifactBodyResponse, error) {
	response, err := h.projectionService.FetchArtifactBody(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
