package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

type AgentChatConfig struct {
	AgentID                string
	HistoryCount           int32
	EnableHistoryCount     bool
	EnableAutoCreateTopic  bool
	AutoCreateTopicThreshold int32
	EnableMaxTokens        bool
	EnableStreaming        bool
	EnableContextCompression bool
	CompressionModelID     string
	ContextWindowSize      int32
	SearchMode             string
	UseModelBuiltinSearch  bool
	UpdatedAt              time.Time
}

type AgentModelParams struct {
	AgentID          string
	Temperature      float64
	TopP             float64
	FrequencyPenalty float64
	PresencePenalty  float64
	MaxTokens        int32
	UpdatedAt        time.Time
}

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

type AgentVoiceConfig struct {
	AgentID     string
	TtsProvider string
	TtsVoice    string
	TtsSpeed    float64
	TtsAutoRead bool
	SttProvider string
	SttLanguage string
	SttAutoStop bool
	UpdatedAt   time.Time
}

type AgentToolProfile struct {
	AgentID   string
	Profile   string
	Allow     string
	Deny      string
	UpdatedAt time.Time
}

type AgentConfigService interface {
	GetChatConfig(ctx context.Context, agentID string) (*AgentChatConfig, error)
	UpdateChatConfig(ctx context.Context, config *AgentChatConfig) (*AgentChatConfig, error)

	GetModelParams(ctx context.Context, agentID string) (*AgentModelParams, error)
	UpdateModelParams(ctx context.Context, params *AgentModelParams) (*AgentModelParams, error)

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

	GetVoiceConfig(ctx context.Context, agentID string) (*AgentVoiceConfig, error)
	UpdateVoiceConfig(ctx context.Context, config *AgentVoiceConfig) (*AgentVoiceConfig, error)

	GetToolProfile(ctx context.Context, agentID string) (*AgentToolProfile, error)
	UpdateToolProfile(ctx context.Context, profile *AgentToolProfile) (*AgentToolProfile, error)
}

type agentConfigService struct {
	db *gorm.DB
}

func NewAgentConfigService(db *gorm.DB) AgentConfigService {
	return &agentConfigService{db: db}
}

func (s *agentConfigService) GetChatConfig(ctx context.Context, agentID string) (*AgentChatConfig, error) {
	var config persistence.AgentChatConfig
	if err := s.db.Where("agent_id = ?", agentID).First(&config).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return &AgentChatConfig{
				AgentID:                agentID,
				HistoryCount:           20,
				EnableHistoryCount:     true,
				EnableAutoCreateTopic:  true,
				AutoCreateTopicThreshold: 10,
				EnableMaxTokens:        false,
				EnableStreaming:        true,
				EnableContextCompression: false,
				ContextWindowSize:      4096,
				SearchMode:             "auto",
				UseModelBuiltinSearch:  false,
				UpdatedAt:              time.Now(),
			}, nil
		}
		return nil, err
	}
	return s.toDomainChatConfig(&config), nil
}

func (s *agentConfigService) UpdateChatConfig(ctx context.Context, config *AgentChatConfig) (*AgentChatConfig, error) {
	record := &persistence.AgentChatConfig{
		AgentID:                config.AgentID,
		HistoryCount:           config.HistoryCount,
		EnableHistoryCount:     config.EnableHistoryCount,
		EnableAutoCreateTopic:  config.EnableAutoCreateTopic,
		AutoCreateTopicThreshold: config.AutoCreateTopicThreshold,
		EnableMaxTokens:        config.EnableMaxTokens,
		EnableStreaming:        config.EnableStreaming,
		EnableContextCompression: config.EnableContextCompression,
		CompressionModelID:     config.CompressionModelID,
		ContextWindowSize:      config.ContextWindowSize,
		SearchMode:             config.SearchMode,
		UseModelBuiltinSearch:  config.UseModelBuiltinSearch,
		UpdatedAt:              time.Now(),
	}

	result := s.db.Where("agent_id = ?", config.AgentID).Assign(record).FirstOrCreate(&persistence.AgentChatConfig{})
	if result.Error != nil {
		return nil, result.Error
	}
	return s.toDomainChatConfig(record), nil
}

func (s *agentConfigService) GetModelParams(ctx context.Context, agentID string) (*AgentModelParams, error) {
	var params persistence.AgentModelParams
	if err := s.db.Where("agent_id = ?", agentID).First(&params).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return &AgentModelParams{
				AgentID:          agentID,
				Temperature:      0.7,
				TopP:             0.9,
				FrequencyPenalty: 0,
				PresencePenalty:  0,
				MaxTokens:        2048,
				UpdatedAt:        time.Now(),
			}, nil
		}
		return nil, err
	}
	return s.toDomainModelParams(&params), nil
}

func (s *agentConfigService) UpdateModelParams(ctx context.Context, params *AgentModelParams) (*AgentModelParams, error) {
	record := &persistence.AgentModelParams{
		AgentID:          params.AgentID,
		Temperature:      params.Temperature,
		TopP:             params.TopP,
		FrequencyPenalty: params.FrequencyPenalty,
		PresencePenalty:  params.PresencePenalty,
		MaxTokens:        params.MaxTokens,
		UpdatedAt:        time.Now(),
	}

	result := s.db.Where("agent_id = ?", params.AgentID).Assign(record).FirstOrCreate(&persistence.AgentModelParams{})
	if result.Error != nil {
		return nil, result.Error
	}
	return s.toDomainModelParams(record), nil
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
	return s.db.Delete(&persistence.AgentKnowledgeBinding{}, id).Error
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
	return s.db.Delete(&persistence.AgentSkillBinding{}, id).Error
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
	return s.db.Delete(&persistence.AgentMcpBinding{}, id).Error
}

func (s *agentConfigService) GetVoiceConfig(ctx context.Context, agentID string) (*AgentVoiceConfig, error) {
	var config persistence.AgentVoiceConfig
	if err := s.db.Where("agent_id = ?", agentID).First(&config).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return &AgentVoiceConfig{
				AgentID:     agentID,
				TtsSpeed:    1.0,
				TtsAutoRead: false,
				SttAutoStop: true,
				UpdatedAt:   time.Now(),
			}, nil
		}
		return nil, err
	}
	return s.toDomainVoiceConfig(&config), nil
}

func (s *agentConfigService) UpdateVoiceConfig(ctx context.Context, config *AgentVoiceConfig) (*AgentVoiceConfig, error) {
	record := &persistence.AgentVoiceConfig{
		AgentID:     config.AgentID,
		TtsProvider: config.TtsProvider,
		TtsVoice:    config.TtsVoice,
		TtsSpeed:    config.TtsSpeed,
		TtsAutoRead: config.TtsAutoRead,
		SttProvider: config.SttProvider,
		SttLanguage: config.SttLanguage,
		SttAutoStop: config.SttAutoStop,
		UpdatedAt:   time.Now(),
	}

	result := s.db.Where("agent_id = ?", config.AgentID).Assign(record).FirstOrCreate(&persistence.AgentVoiceConfig{})
	if result.Error != nil {
		return nil, result.Error
	}
	return s.toDomainVoiceConfig(record), nil
}

func (s *agentConfigService) GetToolProfile(ctx context.Context, agentID string) (*AgentToolProfile, error) {
	var profile persistence.AgentToolProfile
	if err := s.db.Where("agent_id = ?", agentID).First(&profile).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return &AgentToolProfile{
				AgentID:   agentID,
				Profile:   "balanced",
				UpdatedAt: time.Now(),
			}, nil
		}
		return nil, err
	}
	return s.toDomainToolProfile(&profile), nil
}

func (s *agentConfigService) UpdateToolProfile(ctx context.Context, profile *AgentToolProfile) (*AgentToolProfile, error) {
	record := &persistence.AgentToolProfile{
		AgentID:   profile.AgentID,
		Profile:   profile.Profile,
		Allow:     profile.Allow,
		Deny:      profile.Deny,
		UpdatedAt: time.Now(),
	}

	result := s.db.Where("agent_id = ?", profile.AgentID).Assign(record).FirstOrCreate(&persistence.AgentToolProfile{})
	if result.Error != nil {
		return nil, result.Error
	}
	return s.toDomainToolProfile(record), nil
}

func (s *agentConfigService) toDomainChatConfig(c *persistence.AgentChatConfig) *AgentChatConfig {
	return &AgentChatConfig{
		AgentID:                c.AgentID,
		HistoryCount:           c.HistoryCount,
		EnableHistoryCount:     c.EnableHistoryCount,
		EnableAutoCreateTopic:  c.EnableAutoCreateTopic,
		AutoCreateTopicThreshold: c.AutoCreateTopicThreshold,
		EnableMaxTokens:        c.EnableMaxTokens,
		EnableStreaming:        c.EnableStreaming,
		EnableContextCompression: c.EnableContextCompression,
		CompressionModelID:     c.CompressionModelID,
		ContextWindowSize:      c.ContextWindowSize,
		SearchMode:             c.SearchMode,
		UseModelBuiltinSearch:  c.UseModelBuiltinSearch,
		UpdatedAt:              c.UpdatedAt,
	}
}

func (s *agentConfigService) toDomainModelParams(p *persistence.AgentModelParams) *AgentModelParams {
	return &AgentModelParams{
		AgentID:          p.AgentID,
		Temperature:      p.Temperature,
		TopP:             p.TopP,
		FrequencyPenalty: p.FrequencyPenalty,
		PresencePenalty:  p.PresencePenalty,
		MaxTokens:        p.MaxTokens,
		UpdatedAt:        p.UpdatedAt,
	}
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

func (s *agentConfigService) toDomainVoiceConfig(c *persistence.AgentVoiceConfig) *AgentVoiceConfig {
	return &AgentVoiceConfig{
		AgentID:     c.AgentID,
		TtsProvider: c.TtsProvider,
		TtsVoice:    c.TtsVoice,
		TtsSpeed:    c.TtsSpeed,
		TtsAutoRead: c.TtsAutoRead,
		SttProvider: c.SttProvider,
		SttLanguage: c.SttLanguage,
		SttAutoStop: c.SttAutoStop,
		UpdatedAt:   c.UpdatedAt,
	}
}

func (s *agentConfigService) toDomainToolProfile(p *persistence.AgentToolProfile) *AgentToolProfile {
	return &AgentToolProfile{
		AgentID:   p.AgentID,
		Profile:   p.Profile,
		Allow:     p.Allow,
		Deny:      p.Deny,
		UpdatedAt: p.UpdatedAt,
	}
}
