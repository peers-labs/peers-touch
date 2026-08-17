package domain

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

type AgentKnowledgeBinding struct {
	ID         string
	AgentID    string
	ResourceID string
	Policy     string
	Enabled    bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type AgentSkillBinding struct {
	ID        string
	AgentID   string
	SkillID   string
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type AgentMcpBinding struct {
	ID         string
	AgentID    string
	ServerName string
	Enabled    bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type AgentConfigService interface {
	ListKnowledgeBindings(ctx context.Context, agentID string) ([]*AgentKnowledgeBinding, error)
	CreateKnowledgeBinding(ctx context.Context, binding *AgentKnowledgeBinding) (*AgentKnowledgeBinding, error)
	UpdateKnowledgeBinding(ctx context.Context, binding *AgentKnowledgeBinding) (*AgentKnowledgeBinding, error)
	DeleteKnowledgeBinding(ctx context.Context, id string) error

	ListSkillBindings(ctx context.Context, agentID string) ([]*AgentSkillBinding, error)
	CreateSkillBinding(ctx context.Context, binding *AgentSkillBinding) (*AgentSkillBinding, error)
	UpdateSkillBinding(ctx context.Context, binding *AgentSkillBinding) (*AgentSkillBinding, error)
	DeleteSkillBinding(ctx context.Context, id string) error

	ListMcpBindings(ctx context.Context, agentID string) ([]*AgentMcpBinding, error)
	CreateMcpBinding(ctx context.Context, binding *AgentMcpBinding) (*AgentMcpBinding, error)
	UpdateMcpBinding(ctx context.Context, binding *AgentMcpBinding) (*AgentMcpBinding, error)
	DeleteMcpBinding(ctx context.Context, id string) error
}

type agentConfigService struct {
	db *gorm.DB
}

func NewAgentConfigService(db *gorm.DB) AgentConfigService {
	return &agentConfigService{db: db}
}

func (s *agentConfigService) ListKnowledgeBindings(ctx context.Context, agentID string) ([]*AgentKnowledgeBinding, error) {
	var bindings []persistence.AgentKnowledgeBinding
	if err := s.db.Where("agent_id = ?", agentID).Order("created_at DESC").Find(&bindings).Error; err != nil {
		return nil, err
	}

	result := make([]*AgentKnowledgeBinding, 0, len(bindings))
	for _, b := range bindings {
		result = append(result, s.toDomainKnowledgeBinding(&b))
	}
	return result, nil
}

func (s *agentConfigService) CreateKnowledgeBinding(ctx context.Context, binding *AgentKnowledgeBinding) (*AgentKnowledgeBinding, error) {
	record := &persistence.AgentKnowledgeBinding{
		ID:         uuid.New().String(),
		AgentID:    binding.AgentID,
		ResourceID: binding.ResourceID,
		Policy:     binding.Policy,
		Enabled:    binding.Enabled,
	}
	if err := s.db.Create(record).Error; err != nil {
		return nil, err
	}
	return s.toDomainKnowledgeBinding(record), nil
}

func (s *agentConfigService) UpdateKnowledgeBinding(ctx context.Context, binding *AgentKnowledgeBinding) (*AgentKnowledgeBinding, error) {
	var record persistence.AgentKnowledgeBinding
	if err := s.db.Where("id = ?", binding.ID).First(&record).Error; err != nil {
		return nil, err
	}

	record.ResourceID = binding.ResourceID
	record.Policy = binding.Policy
	record.Enabled = binding.Enabled
	record.UpdatedAt = time.Now()

	if err := s.db.Save(&record).Error; err != nil {
		return nil, err
	}
	return s.toDomainKnowledgeBinding(&record), nil
}

func (s *agentConfigService) DeleteKnowledgeBinding(ctx context.Context, id string) error {
	result := s.db.WithContext(ctx).Where("id = ?", id).Delete(&persistence.AgentKnowledgeBinding{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("agent knowledge binding not found: %s", id)
	}
	return nil
}

func (s *agentConfigService) ListSkillBindings(ctx context.Context, agentID string) ([]*AgentSkillBinding, error) {
	var bindings []persistence.AgentSkillBinding
	if err := s.db.Where("agent_id = ?", agentID).Order("created_at DESC").Find(&bindings).Error; err != nil {
		return nil, err
	}

	result := make([]*AgentSkillBinding, 0, len(bindings))
	for _, b := range bindings {
		result = append(result, s.toDomainSkillBinding(&b))
	}
	return result, nil
}

func (s *agentConfigService) CreateSkillBinding(ctx context.Context, binding *AgentSkillBinding) (*AgentSkillBinding, error) {
	record := &persistence.AgentSkillBinding{
		ID:      uuid.New().String(),
		AgentID: binding.AgentID,
		SkillID: binding.SkillID,
		Enabled: binding.Enabled,
	}
	if err := s.db.Create(record).Error; err != nil {
		return nil, err
	}
	return s.toDomainSkillBinding(record), nil
}

func (s *agentConfigService) UpdateSkillBinding(ctx context.Context, binding *AgentSkillBinding) (*AgentSkillBinding, error) {
	var record persistence.AgentSkillBinding
	if err := s.db.Where("id = ?", binding.ID).First(&record).Error; err != nil {
		return nil, err
	}

	record.SkillID = binding.SkillID
	record.Enabled = binding.Enabled
	record.UpdatedAt = time.Now()

	if err := s.db.Save(&record).Error; err != nil {
		return nil, err
	}
	return s.toDomainSkillBinding(&record), nil
}

func (s *agentConfigService) DeleteSkillBinding(ctx context.Context, id string) error {
	result := s.db.WithContext(ctx).Where("id = ?", id).Delete(&persistence.AgentSkillBinding{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("agent skill binding not found: %s", id)
	}
	return nil
}

func (s *agentConfigService) ListMcpBindings(ctx context.Context, agentID string) ([]*AgentMcpBinding, error) {
	var bindings []persistence.AgentMcpBinding
	if err := s.db.Where("agent_id = ?", agentID).Order("created_at DESC").Find(&bindings).Error; err != nil {
		return nil, err
	}

	result := make([]*AgentMcpBinding, 0, len(bindings))
	for _, b := range bindings {
		result = append(result, s.toDomainMcpBinding(&b))
	}
	return result, nil
}

func (s *agentConfigService) CreateMcpBinding(ctx context.Context, binding *AgentMcpBinding) (*AgentMcpBinding, error) {
	record := &persistence.AgentMcpBinding{
		ID:         uuid.New().String(),
		AgentID:    binding.AgentID,
		ServerName: binding.ServerName,
		Enabled:    binding.Enabled,
	}
	if err := s.db.Create(record).Error; err != nil {
		return nil, err
	}
	return s.toDomainMcpBinding(record), nil
}

func (s *agentConfigService) UpdateMcpBinding(ctx context.Context, binding *AgentMcpBinding) (*AgentMcpBinding, error) {
	var record persistence.AgentMcpBinding
	if err := s.db.Where("id = ?", binding.ID).First(&record).Error; err != nil {
		return nil, err
	}

	record.ServerName = binding.ServerName
	record.Enabled = binding.Enabled
	record.UpdatedAt = time.Now()

	if err := s.db.Save(&record).Error; err != nil {
		return nil, err
	}
	return s.toDomainMcpBinding(&record), nil
}

func (s *agentConfigService) DeleteMcpBinding(ctx context.Context, id string) error {
	result := s.db.WithContext(ctx).Where("id = ?", id).Delete(&persistence.AgentMcpBinding{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("agent MCP binding not found: %s", id)
	}
	return nil
}

func (s *agentConfigService) toDomainKnowledgeBinding(b *persistence.AgentKnowledgeBinding) *AgentKnowledgeBinding {
	return &AgentKnowledgeBinding{
		ID:         b.ID,
		AgentID:    b.AgentID,
		ResourceID: b.ResourceID,
		Policy:     b.Policy,
		Enabled:    b.Enabled,
		CreatedAt:  b.CreatedAt,
		UpdatedAt:  b.UpdatedAt,
	}
}

func (s *agentConfigService) toDomainSkillBinding(b *persistence.AgentSkillBinding) *AgentSkillBinding {
	return &AgentSkillBinding{
		ID:        b.ID,
		AgentID:   b.AgentID,
		SkillID:   b.SkillID,
		Enabled:   b.Enabled,
		CreatedAt: b.CreatedAt,
		UpdatedAt: b.UpdatedAt,
	}
}

func (s *agentConfigService) toDomainMcpBinding(b *persistence.AgentMcpBinding) *AgentMcpBinding {
	return &AgentMcpBinding{
		ID:         b.ID,
		AgentID:    b.AgentID,
		ServerName: b.ServerName,
		Enabled:    b.Enabled,
		CreatedAt:  b.CreatedAt,
		UpdatedAt:  b.UpdatedAt,
	}
}
