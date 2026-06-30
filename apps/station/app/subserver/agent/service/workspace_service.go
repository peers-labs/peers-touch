package service

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type WorkspaceService struct {
	domainService domain.WorkspaceService
}

func NewWorkspaceService() *WorkspaceService {
	db, _ := store.GetRDS(context.Background(), store.WithRDSDBName("agent"))
	return &WorkspaceService{
		domainService: domain.NewWorkspaceService(db),
	}
}

func (s *WorkspaceService) CreateWorkspace(ctx context.Context, req *model.CreateWorkspaceRequest) (*model.CreateWorkspaceResponse, error) {
	meta := make(map[string]string)
	for k, v := range req.GetMeta() {
		meta[k] = v
	}

	workspace, err := s.domainService.CreateWorkspace(ctx, req.GetAgentId(), req.GetName(), meta)
	if err != nil {
		return nil, err
	}

	return &model.CreateWorkspaceResponse{
		Workspace: s.toProtoWorkspace(workspace),
	}, nil
}

func (s *WorkspaceService) GetWorkspace(ctx context.Context, req *model.GetWorkspaceRequest) (*model.GetWorkspaceResponse, error) {
	workspace, err := s.domainService.GetWorkspace(ctx, req.GetId())
	if err != nil {
		return nil, err
	}

	files, _, _, err := s.domainService.ListFiles(ctx, workspace.ID, "", 1, 100)
	if err != nil {
		return nil, err
	}

	return &model.GetWorkspaceResponse{
		Workspace: s.toProtoWorkspace(workspace),
		Files:     s.toProtoWorkspaceFiles(files),
	}, nil
}

func (s *WorkspaceService) ListWorkspaces(ctx context.Context, req *model.ListWorkspacesRequest) (*model.ListWorkspacesResponse, error) {
	page := int(req.GetPage())
	if page <= 0 {
		page = 1
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 20
	}

	workspaces, total, err := s.domainService.ListWorkspaces(ctx, req.GetAgentId(), page, pageSize)
	if err != nil {
		return nil, err
	}

	return &model.ListWorkspacesResponse{
		Workspaces: s.toProtoWorkspaces(workspaces),
		Total:      int32(total),
	}, nil
}

func (s *WorkspaceService) UpdateWorkspace(ctx context.Context, req *model.UpdateWorkspaceRequest) (*model.UpdateWorkspaceResponse, error) {
	meta := make(map[string]string)
	for k, v := range req.GetMeta() {
		meta[k] = v
	}

	var name *string
	if req.Name != nil {
		name = new(string)
		*name = *req.Name
	}

	workspace, err := s.domainService.UpdateWorkspace(ctx, req.GetId(), name, meta)
	if err != nil {
		return nil, err
	}

	return &model.UpdateWorkspaceResponse{
		Workspace: s.toProtoWorkspace(workspace),
	}, nil
}

func (s *WorkspaceService) DeleteWorkspace(ctx context.Context, req *model.DeleteWorkspaceRequest) (*model.DeleteWorkspaceResponse, error) {
	if err := s.domainService.DeleteWorkspace(ctx, req.GetId()); err != nil {
		return nil, err
	}

	return &model.DeleteWorkspaceResponse{Success: true}, nil
}

func (s *WorkspaceService) ListFiles(ctx context.Context, req *model.GetWorkspaceFilesRequest) (*model.GetWorkspaceFilesResponse, error) {
	page := int(req.GetPage())
	if page <= 0 {
		page = 1
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	}

	files, total, nextCursor, err := s.domainService.ListFiles(ctx, req.GetWorkspaceId(), req.GetSince(), page, pageSize)
	if err != nil {
		return nil, err
	}

	return &model.GetWorkspaceFilesResponse{
		Files:      s.toProtoWorkspaceFiles(files),
		Total:      int32(total),
		NextCursor: nextCursor,
	}, nil
}

func (s *WorkspaceService) GetFileDiff(ctx context.Context, req *model.GetWorkspaceFileDiffRequest) (*model.GetWorkspaceFileDiffResponse, error) {
	changes, deleted, err := s.domainService.GetFileDiff(ctx, req.GetWorkspaceId(), req.GetSince())
	if err != nil {
		return nil, err
	}

	return &model.GetWorkspaceFileDiffResponse{
		Changed: s.toProtoWorkspaceChanges(changes),
		Deleted: deleted,
	}, nil
}

func (s *WorkspaceService) CommitChanges(ctx context.Context, req *model.CommitWorkspaceChangesRequest) (*model.CommitWorkspaceChangesResponse, error) {
	changes := make([]domain.WorkspaceChange, 0, len(req.GetChanges()))
	for _, c := range req.GetChanges() {
		changes = append(changes, domain.WorkspaceChange{
			Path:      c.GetPath(),
			ChangeType: c.GetChangeType(),
			Size:      c.GetSize(),
			SHA256:    c.GetSha256(),
			MimeType:  c.GetMimeType(),
		})
	}

	if err := s.domainService.CommitChanges(ctx, req.GetWorkspaceId(), changes, req.GetClientRequestId()); err != nil {
		return nil, err
	}

	return &model.CommitWorkspaceChangesResponse{Success: true}, nil
}

func (s *WorkspaceService) DeleteFiles(ctx context.Context, req *model.DeleteWorkspaceFilesRequest) (*model.DeleteWorkspaceFilesResponse, error) {
	if err := s.domainService.DeleteFiles(ctx, req.GetWorkspaceId(), req.GetPaths()); err != nil {
		return nil, err
	}

	return &model.DeleteWorkspaceFilesResponse{Success: true}, nil
}

func (s *WorkspaceService) toProtoWorkspace(w *domain.Workspace) *model.Workspace {
	meta := make(map[string]string)
	for k, v := range w.Meta {
		meta[k] = v
	}

	return &model.Workspace{
		Id:             w.ID,
		AgentId:        w.AgentID,
		Name:           w.Name,
		Type:           model.WorkspaceType(model.WorkspaceType_value["WORKSPACE_TYPE_"+w.Type]),
		StorageBackend: model.WorkspaceStorageBackend(model.WorkspaceStorageBackend_value["WORKSPACE_STORAGE_BACKEND_"+w.StorageBackend]),
		TotalBytes:     w.TotalBytes,
		FileCount:      w.FileCount,
		Meta:           meta,
	}
}

func (s *WorkspaceService) toProtoWorkspaces(workspaces []*domain.Workspace) []*model.Workspace {
	result := make([]*model.Workspace, 0, len(workspaces))
	for _, w := range workspaces {
		result = append(result, s.toProtoWorkspace(w))
	}
	return result
}

func (s *WorkspaceService) toProtoWorkspaceFiles(files []*domain.WorkspaceFile) []*model.WorkspaceFile {
	result := make([]*model.WorkspaceFile, 0, len(files))
	for _, f := range files {
		result = append(result, &model.WorkspaceFile{
			Id:            f.ID,
			WorkspaceId:   f.WorkspaceID,
			Path:          f.Path,
			Size:          f.Size,
			Sha256:        f.SHA256,
			MimeType:      f.MimeType,
		})
	}
	return result
}

func (s *WorkspaceService) toProtoWorkspaceChanges(changes []domain.WorkspaceChange) []*model.WorkspaceChange {
	result := make([]*model.WorkspaceChange, 0, len(changes))
	for _, c := range changes {
		var size *int64
		if c.Size > 0 {
			size = new(int64)
			*size = c.Size
		}

		var sha256 *string
		if c.SHA256 != "" {
			sha256 = new(string)
			*sha256 = c.SHA256
		}

		var mimeType *string
		if c.MimeType != "" {
			mimeType = new(string)
			*mimeType = c.MimeType
		}

		result = append(result, &model.WorkspaceChange{
			Path:      c.Path,
			ChangeType: c.ChangeType,
			Size:      size,
			Sha256:    sha256,
			MimeType:  mimeType,
		})
	}
	return result
}
