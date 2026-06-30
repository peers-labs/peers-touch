package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

type Workspace struct {
	ID               string
	AgentID          string
	Name             string
	Type             string
	StorageBackend   string
	OSSBucket        string
	OSSPrefix        string
	TotalBytes       int64
	FileCount        int32
	LastSyncedAt     *time.Time
	LastSyncedDevice string
	Meta             map[string]string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type WorkspaceFile struct {
	ID             string
	WorkspaceID    string
	Path           string
	Size           int64
	SHA256         string
	MimeType       string
	LastModifiedAt *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type WorkspaceChange struct {
	Path       string
	ChangeType string
	Size       int64
	SHA256     string
	MimeType   string
}

type WorkspaceService interface {
	CreateWorkspace(ctx context.Context, agentID, name string, meta map[string]string) (*Workspace, error)
	GetWorkspace(ctx context.Context, id string) (*Workspace, error)
	ListWorkspaces(ctx context.Context, agentID string, page, pageSize int) ([]*Workspace, int, error)
	UpdateWorkspace(ctx context.Context, id string, name *string, meta map[string]string) (*Workspace, error)
	DeleteWorkspace(ctx context.Context, id string) error
	ListFiles(ctx context.Context, workspaceID string, since string, page, pageSize int) ([]*WorkspaceFile, int, string, error)
	GetFileDiff(ctx context.Context, workspaceID string, since string) ([]WorkspaceChange, []string, error)
	CommitChanges(ctx context.Context, workspaceID string, changes []WorkspaceChange, clientRequestID string) error
	DeleteFiles(ctx context.Context, workspaceID string, paths []string) error
}

type workspaceService struct {
	db *gorm.DB
}

func NewWorkspaceService(db *gorm.DB) WorkspaceService {
	return &workspaceService{db: db}
}

func (s *workspaceService) CreateWorkspace(ctx context.Context, agentID, name string, meta map[string]string) (*Workspace, error) {
	workspace := &persistence.AgentWorkspace{
		ID:             uuid.New().String(),
		AgentID:        agentID,
		Name:           name,
		Type:           "directory",
		StorageBackend: "oss",
		OSSPrefix:      fmt.Sprintf("agent/%s/workspace/", agentID),
		Meta:           "",
	}

	if meta != nil {
		data, err := json.Marshal(meta)
		if err != nil {
			return nil, err
		}
		workspace.Meta = string(data)
	}

	if err := s.db.Create(workspace).Error; err != nil {
		return nil, err
	}

	return s.toDomainWorkspace(workspace), nil
}

func (s *workspaceService) GetWorkspace(ctx context.Context, id string) (*Workspace, error) {
	var workspace persistence.AgentWorkspace
	if err := s.db.Where("id = ?", id).First(&workspace).Error; err != nil {
		return nil, err
	}
	return s.toDomainWorkspace(&workspace), nil
}

func (s *workspaceService) ListWorkspaces(ctx context.Context, agentID string, page, pageSize int) ([]*Workspace, int, error) {
	var workspaces []persistence.AgentWorkspace
	var total int64

	offset := (page - 1) * pageSize

	if err := s.db.Model(&persistence.AgentWorkspace{}).Where("agent_id = ?", agentID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := s.db.Where("agent_id = ?", agentID).Offset(offset).Limit(pageSize).Order("created_at DESC").Find(&workspaces).Error; err != nil {
		return nil, 0, err
	}

	result := make([]*Workspace, 0, len(workspaces))
	for _, w := range workspaces {
		result = append(result, s.toDomainWorkspace(&w))
	}

	return result, int(total), nil
}

func (s *workspaceService) UpdateWorkspace(ctx context.Context, id string, name *string, meta map[string]string) (*Workspace, error) {
	var workspace persistence.AgentWorkspace
	if err := s.db.Where("id = ?", id).First(&workspace).Error; err != nil {
		return nil, err
	}

	if name != nil {
		workspace.Name = *name
	}

	if meta != nil {
		data, err := json.Marshal(meta)
		if err != nil {
			return nil, err
		}
		workspace.Meta = string(data)
	}

	if err := s.db.Save(&workspace).Error; err != nil {
		return nil, err
	}

	return s.toDomainWorkspace(&workspace), nil
}

func (s *workspaceService) DeleteWorkspace(ctx context.Context, id string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("workspace_id = ?", id).Delete(&persistence.AgentWorkspaceFile{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&persistence.AgentWorkspace{}).Error
	})
}

func (s *workspaceService) ListFiles(ctx context.Context, workspaceID string, since string, page, pageSize int) ([]*WorkspaceFile, int, string, error) {
	var files []persistence.AgentWorkspaceFile
	var total int64

	offset := (page - 1) * pageSize

	query := s.db.Model(&persistence.AgentWorkspaceFile{}).Where("workspace_id = ?", workspaceID)

	if since != "" {
		query = query.Where("updated_at > ?", since)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, "", err
	}

	if err := query.Offset(offset).Limit(pageSize).Order("path").Find(&files).Error; err != nil {
		return nil, 0, "", err
	}

	result := make([]*WorkspaceFile, 0, len(files))
	for _, f := range files {
		result = append(result, s.toDomainWorkspaceFile(&f))
	}

	nextCursor := ""
	if offset+pageSize < int(total) {
		nextCursor = fmt.Sprintf("%d", offset+pageSize)
	}

	return result, int(total), nextCursor, nil
}

func (s *workspaceService) GetFileDiff(ctx context.Context, workspaceID string, since string) ([]WorkspaceChange, []string, error) {
	var files []persistence.AgentWorkspaceFile
	query := s.db.Where("workspace_id = ?", workspaceID)

	if since != "" {
		query = query.Where("updated_at > ?", since)
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, nil, err
	}

	changes := make([]WorkspaceChange, 0)
	deleted := make([]string, 0)

	for _, f := range files {
		changes = append(changes, WorkspaceChange{
			Path:       f.Path,
			ChangeType: "modified",
			Size:       f.Size,
			SHA256:     f.SHA256,
			MimeType:   f.MimeType,
		})
	}

	return changes, deleted, nil
}

func (s *workspaceService) CommitChanges(ctx context.Context, workspaceID string, changes []WorkspaceChange, clientRequestID string) error {
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	for _, change := range changes {
		switch change.ChangeType {
		case "added", "modified":
			var file persistence.AgentWorkspaceFile
			if err := tx.Where("workspace_id = ? AND path = ?", workspaceID, change.Path).First(&file).Error; err != nil {
				if err == gorm.ErrRecordNotFound {
					file = persistence.AgentWorkspaceFile{
						ID:          uuid.New().String(),
						WorkspaceID: workspaceID,
						Path:        change.Path,
					}
				} else {
					tx.Rollback()
					return err
				}
			}

			file.Size = change.Size
			file.SHA256 = change.SHA256
			file.MimeType = change.MimeType
			if err := tx.Save(&file).Error; err != nil {
				tx.Rollback()
				return err
			}
		case "deleted":
			if err := tx.Where("workspace_id = ? AND path = ?", workspaceID, change.Path).Delete(&persistence.AgentWorkspaceFile{}).Error; err != nil {
				tx.Rollback()
				return err
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}

	return nil
}

func (s *workspaceService) DeleteFiles(ctx context.Context, workspaceID string, paths []string) error {
	return s.db.Where("workspace_id = ? AND path IN ?", workspaceID, paths).Delete(&persistence.AgentWorkspaceFile{}).Error
}

func (s *workspaceService) toDomainWorkspace(w *persistence.AgentWorkspace) *Workspace {
	meta := make(map[string]string)
	if w.Meta != "" {
		_ = json.Unmarshal([]byte(w.Meta), &meta)
	}

	return &Workspace{
		ID:               w.ID,
		AgentID:          w.AgentID,
		Name:             w.Name,
		Type:             w.Type,
		StorageBackend:   w.StorageBackend,
		OSSBucket:        w.OSSBucket,
		OSSPrefix:        w.OSSPrefix,
		TotalBytes:       w.TotalBytes,
		FileCount:        w.FileCount,
		LastSyncedAt:     w.LastSyncedAt,
		LastSyncedDevice: w.LastSyncedDevice,
		Meta:             meta,
		CreatedAt:        w.CreatedAt,
		UpdatedAt:        w.UpdatedAt,
	}
}

func (s *workspaceService) toDomainWorkspaceFile(f *persistence.AgentWorkspaceFile) *WorkspaceFile {
	return &WorkspaceFile{
		ID:             f.ID,
		WorkspaceID:    f.WorkspaceID,
		Path:           f.Path,
		Size:           f.Size,
		SHA256:         f.SHA256,
		MimeType:       f.MimeType,
		LastModifiedAt: f.LastModifiedAt,
		CreatedAt:      f.CreatedAt,
		UpdatedAt:      f.UpdatedAt,
	}
}
