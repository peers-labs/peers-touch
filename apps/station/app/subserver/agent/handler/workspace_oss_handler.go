package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type WorkspaceOSSHandlers struct {
	ossService *service.WorkspaceOSSService
}

func NewWorkspaceOSSHandlers(ossService *service.WorkspaceOSSService) *WorkspaceOSSHandlers {
	return &WorkspaceOSSHandlers{ossService: ossService}
}

func (h *WorkspaceOSSHandlers) HandlePrepareArtifactUpload(
	ctx context.Context,
	req *model.PrepareTurnArtifactUploadRequest,
) (*model.PrepareTurnArtifactUploadResponse, error) {
	response, err := h.ossService.PrepareArtifactUpload(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *WorkspaceOSSHandlers) HandleCompleteArtifactUpload(
	ctx context.Context,
	req *model.CompleteTurnArtifactUploadRequest,
) (*model.CompleteTurnArtifactUploadResponse, error) {
	response, err := h.ossService.CompleteArtifactUpload(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *WorkspaceOSSHandlers) HandleGetArtifactDownload(
	ctx context.Context,
	req *model.GetTurnArtifactDownloadRequest,
) (*model.GetTurnArtifactDownloadResponse, error) {
	response, err := h.ossService.GetArtifactDownload(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
