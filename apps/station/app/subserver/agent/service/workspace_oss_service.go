package service

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type WorkspaceOSSService struct {
	workspaceService domain.WorkspaceService
	storageBackend   storage.Backend
}

func NewWorkspaceOSSService(storageBackend storage.Backend) *WorkspaceOSSService {
	db, _ := store.GetRDS(context.Background(), store.WithRDSDBName("agent"))
	return &WorkspaceOSSService{
		workspaceService: domain.NewWorkspaceService(db),
		storageBackend:   storageBackend,
	}
}

func (s *WorkspaceOSSService) GetUploadPresignedURL(ctx context.Context, req *model.GetWorkspaceFileUploadUrlRequest) (*model.GetWorkspaceFileUploadUrlResponse, error) {
	workspace, err := s.workspaceService.GetWorkspace(ctx, req.GetWorkspaceId())
	if err != nil {
		return nil, err
	}

	presignedBackend, ok := s.storageBackend.(storage.PresignedBackend)
	if !ok {
		return nil, fmt.Errorf("storage backend does not support presigned URLs")
	}

	key := fmt.Sprintf("%s%s", workspace.OSSPrefix, req.GetPath())
	ttl := 3600 * time.Second

	request, err := presignedBackend.PresignPut(ctx, key, req.GetContentType(), req.GetContentLength(), req.GetContentSha256(), ttl)
	if err != nil {
		return nil, err
	}

	return &model.GetWorkspaceFileUploadUrlResponse{
		Url:       request.URL,
		Path:      req.GetPath(),
		ExpiresIn: int64(ttl.Seconds()),
	}, nil
}

func (s *WorkspaceOSSService) GetDownloadPresignedURL(ctx context.Context, req *model.GetWorkspaceFileDownloadUrlRequest) (*model.GetWorkspaceFileDownloadUrlResponse, error) {
	workspace, err := s.workspaceService.GetWorkspace(ctx, req.GetWorkspaceId())
	if err != nil {
		return nil, err
	}

	presignedBackend, ok := s.storageBackend.(storage.PresignedBackend)
	if !ok {
		return nil, fmt.Errorf("storage backend does not support presigned URLs")
	}

	key := fmt.Sprintf("%s%s", workspace.OSSPrefix, req.GetPath())
	ttl := 3600 * time.Second

	request, err := presignedBackend.PresignGet(ctx, key, ttl)
	if err != nil {
		return nil, err
	}

	return &model.GetWorkspaceFileDownloadUrlResponse{
		Url:       request.URL,
		ExpiresIn: int64(ttl.Seconds()),
	}, nil
}
