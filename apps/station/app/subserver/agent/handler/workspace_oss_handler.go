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

func (h *WorkspaceOSSHandlers) HandleGetUploadPresignedURL(ctx context.Context, req *model.GetWorkspaceFileUploadUrlRequest) (*model.GetWorkspaceFileUploadUrlResponse, error) {
	return h.ossService.GetUploadPresignedURL(ctx, req)
}

func (h *WorkspaceOSSHandlers) HandleGetDownloadPresignedURL(ctx context.Context, req *model.GetWorkspaceFileDownloadUrlRequest) (*model.GetWorkspaceFileDownloadUrlResponse, error) {
	return h.ossService.GetDownloadPresignedURL(ctx, req)
}
