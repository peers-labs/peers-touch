package service

import (
	"context"
	"fmt"

	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
	"gorm.io/gorm"
)

type ContextService interface {
	GetProjectContext(ctx context.Context, projectID string) (*types.ProjectContext, error)
	SaveProjectContext(ctx context.Context, project *types.ProjectContext) error
	ListProjectContexts(ctx context.Context) ([]*types.ProjectContext, error)
	GetAIAgentConfig(ctx context.Context, projectID string) (*types.AIAgentConfig, error)
	SaveAIAgentConfig(ctx context.Context, config *types.AIAgentConfig) error
}

type contextService struct {
	db *gorm.DB
}

func NewContextService(db *gorm.DB) ContextService {
	return &contextService{db: db}
}

func (s *contextService) GetProjectContext(ctx context.Context, projectID string) (*types.ProjectContext, error) {
	var project types.ProjectContext
	if err := s.db.WithContext(ctx).First(&project, "project_id = ?", projectID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("project context not found: %s", projectID)
		}
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	return &project, nil
}

func (s *contextService) SaveProjectContext(ctx context.Context, project *types.ProjectContext) error {
	return s.db.WithContext(ctx).Save(project).Error
}

func (s *contextService) ListProjectContexts(ctx context.Context) ([]*types.ProjectContext, error) {
	var projects []*types.ProjectContext
	if err := s.db.WithContext(ctx).Find(&projects).Error; err != nil {
		return nil, fmt.Errorf("failed to list project contexts: %w", err)
	}
	return projects, nil
}

func (s *contextService) GetAIAgentConfig(ctx context.Context, projectID string) (*types.AIAgentConfig, error) {
	var config types.AIAgentConfig
	if err := s.db.WithContext(ctx).First(&config, "project_id = ?", projectID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("AI agent config not found: %s", projectID)
		}
		return nil, fmt.Errorf("failed to get AI agent config: %w", err)
	}
	return &config, nil
}

func (s *contextService) SaveAIAgentConfig(ctx context.Context, config *types.AIAgentConfig) error {
	return s.db.WithContext(ctx).Save(config).Error
}