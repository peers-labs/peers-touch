package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type WorkspaceHandlers struct {
	workspaceService *service.WorkspaceService
}

func NewWorkspaceHandlers(workspaceService *service.WorkspaceService) *WorkspaceHandlers {
	return &WorkspaceHandlers{workspaceService: workspaceService}
}

func (h *WorkspaceHandlers) HandleCreateWorkspace(ctx context.Context, req *model.CreateWorkspaceRequest) (*model.CreateWorkspaceResponse, error) {
	return h.workspaceService.CreateWorkspace(ctx, req)
}

func (h *WorkspaceHandlers) HandleGetWorkspace(ctx context.Context, req *model.GetWorkspaceRequest) (*model.GetWorkspaceResponse, error) {
	return h.workspaceService.GetWorkspace(ctx, req)
}

func (h *WorkspaceHandlers) HandleListWorkspaces(ctx context.Context, req *model.ListWorkspacesRequest) (*model.ListWorkspacesResponse, error) {
	return h.workspaceService.ListWorkspaces(ctx, req)
}

func (h *WorkspaceHandlers) HandleUpdateWorkspace(ctx context.Context, req *model.UpdateWorkspaceRequest) (*model.UpdateWorkspaceResponse, error) {
	return h.workspaceService.UpdateWorkspace(ctx, req)
}

func (h *WorkspaceHandlers) HandleDeleteWorkspace(ctx context.Context, req *model.DeleteWorkspaceRequest) (*model.DeleteWorkspaceResponse, error) {
	return h.workspaceService.DeleteWorkspace(ctx, req)
}

func (h *WorkspaceHandlers) HandleListFiles(ctx context.Context, req *model.GetWorkspaceFilesRequest) (*model.GetWorkspaceFilesResponse, error) {
	return h.workspaceService.ListFiles(ctx, req)
}

func (h *WorkspaceHandlers) HandleGetFileDiff(ctx context.Context, req *model.GetWorkspaceFileDiffRequest) (*model.GetWorkspaceFileDiffResponse, error) {
	return h.workspaceService.GetFileDiff(ctx, req)
}

func (h *WorkspaceHandlers) HandleCommitChanges(ctx context.Context, req *model.CommitWorkspaceChangesRequest) (*model.CommitWorkspaceChangesResponse, error) {
	return h.workspaceService.CommitChanges(ctx, req)
}

func (h *WorkspaceHandlers) HandleDeleteFiles(ctx context.Context, req *model.DeleteWorkspaceFilesRequest) (*model.DeleteWorkspaceFilesResponse, error) {
	return h.workspaceService.DeleteFiles(ctx, req)
}
