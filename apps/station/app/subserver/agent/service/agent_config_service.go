package service

import (
	"context"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type AgentConfigService struct {
	domainService domain.AgentConfigService
}

func NewAgentConfigService() *AgentConfigService {
	db, _ := store.GetRDS(context.Background(), store.WithRDSDBName("agent"))
	return &AgentConfigService{
		domainService: domain.NewAgentConfigService(db),
	}
}

func (s *AgentConfigService) GetChatConfig(ctx context.Context, req *model.GetAgentChatConfigRequest) (*model.GetAgentChatConfigResponse, error) {
	config, err := s.domainService.GetChatConfig(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.GetAgentChatConfigResponse{
		Config: s.toProtoChatConfig(config),
	}, nil
}

func (s *AgentConfigService) UpdateChatConfig(ctx context.Context, req *model.UpdateAgentChatConfigRequest) (*model.UpdateAgentChatConfigResponse, error) {
	config := s.fromProtoChatConfig(req.GetConfig())
	result, err := s.domainService.UpdateChatConfig(ctx, config)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentChatConfigResponse{
		Config: s.toProtoChatConfig(result),
	}, nil
}

func (s *AgentConfigService) GetModelParams(ctx context.Context, req *model.GetAgentModelParamsRequest) (*model.GetAgentModelParamsResponse, error) {
	params, err := s.domainService.GetModelParams(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.GetAgentModelParamsResponse{
		Params: s.toProtoModelParams(params),
	}, nil
}

func (s *AgentConfigService) UpdateModelParams(ctx context.Context, req *model.UpdateAgentModelParamsRequest) (*model.UpdateAgentModelParamsResponse, error) {
	params := s.fromProtoModelParams(req.GetParams())
	result, err := s.domainService.UpdateModelParams(ctx, params)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentModelParamsResponse{
		Params: s.toProtoModelParams(result),
	}, nil
}

func (s *AgentConfigService) ListKnowledgeBindings(ctx context.Context, req *model.ListAgentKnowledgeBindingsRequest) (*model.ListAgentKnowledgeBindingsResponse, error) {
	bindings, err := s.domainService.ListKnowledgeBindings(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.ListAgentKnowledgeBindingsResponse{
		Bindings: s.toProtoKnowledgeBindings(bindings),
	}, nil
}

func (s *AgentConfigService) CreateKnowledgeBinding(ctx context.Context, req *model.CreateAgentKnowledgeBindingRequest) (*model.CreateAgentKnowledgeBindingResponse, error) {
	binding := s.fromProtoKnowledgeBinding(req.GetBinding())
	result, err := s.domainService.CreateKnowledgeBinding(ctx, binding)
	if err != nil {
		return nil, err
	}

	return &model.CreateAgentKnowledgeBindingResponse{
		Binding: s.toProtoKnowledgeBinding(result),
	}, nil
}

func (s *AgentConfigService) UpdateKnowledgeBinding(ctx context.Context, req *model.UpdateAgentKnowledgeBindingRequest) (*model.UpdateAgentKnowledgeBindingResponse, error) {
	binding := s.fromProtoKnowledgeBinding(req.GetBinding())
	result, err := s.domainService.UpdateKnowledgeBinding(ctx, binding)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentKnowledgeBindingResponse{
		Binding: s.toProtoKnowledgeBinding(result),
	}, nil
}

func (s *AgentConfigService) DeleteKnowledgeBinding(ctx context.Context, req *model.DeleteAgentKnowledgeBindingRequest) (*model.DeleteAgentKnowledgeBindingResponse, error) {
	if err := s.domainService.DeleteKnowledgeBinding(ctx, req.GetId()); err != nil {
		return nil, err
	}
	return &model.DeleteAgentKnowledgeBindingResponse{Success: true}, nil
}

func (s *AgentConfigService) ListSkillBindings(ctx context.Context, req *model.ListAgentSkillBindingsRequest) (*model.ListAgentSkillBindingsResponse, error) {
	bindings, err := s.domainService.ListSkillBindings(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.ListAgentSkillBindingsResponse{
		Bindings: s.toProtoSkillBindings(bindings),
	}, nil
}

func (s *AgentConfigService) CreateSkillBinding(ctx context.Context, req *model.CreateAgentSkillBindingRequest) (*model.CreateAgentSkillBindingResponse, error) {
	binding := s.fromProtoSkillBinding(req.GetBinding())
	result, err := s.domainService.CreateSkillBinding(ctx, binding)
	if err != nil {
		return nil, err
	}

	return &model.CreateAgentSkillBindingResponse{
		Binding: s.toProtoSkillBinding(result),
	}, nil
}

func (s *AgentConfigService) UpdateSkillBinding(ctx context.Context, req *model.UpdateAgentSkillBindingRequest) (*model.UpdateAgentSkillBindingResponse, error) {
	binding := s.fromProtoSkillBinding(req.GetBinding())
	result, err := s.domainService.UpdateSkillBinding(ctx, binding)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentSkillBindingResponse{
		Binding: s.toProtoSkillBinding(result),
	}, nil
}

func (s *AgentConfigService) DeleteSkillBinding(ctx context.Context, req *model.DeleteAgentSkillBindingRequest) (*model.DeleteAgentSkillBindingResponse, error) {
	if err := s.domainService.DeleteSkillBinding(ctx, req.GetId()); err != nil {
		return nil, err
	}
	return &model.DeleteAgentSkillBindingResponse{Success: true}, nil
}

func (s *AgentConfigService) ListMcpBindings(ctx context.Context, req *model.ListAgentMcpBindingsRequest) (*model.ListAgentMcpBindingsResponse, error) {
	bindings, err := s.domainService.ListMcpBindings(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.ListAgentMcpBindingsResponse{
		Bindings: s.toProtoMcpBindings(bindings),
	}, nil
}

func (s *AgentConfigService) CreateMcpBinding(ctx context.Context, req *model.CreateAgentMcpBindingRequest) (*model.CreateAgentMcpBindingResponse, error) {
	binding := s.fromProtoMcpBinding(req.GetBinding())
	result, err := s.domainService.CreateMcpBinding(ctx, binding)
	if err != nil {
		return nil, err
	}

	return &model.CreateAgentMcpBindingResponse{
		Binding: s.toProtoMcpBinding(result),
	}, nil
}

func (s *AgentConfigService) UpdateMcpBinding(ctx context.Context, req *model.UpdateAgentMcpBindingRequest) (*model.UpdateAgentMcpBindingResponse, error) {
	binding := s.fromProtoMcpBinding(req.GetBinding())
	result, err := s.domainService.UpdateMcpBinding(ctx, binding)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentMcpBindingResponse{
		Binding: s.toProtoMcpBinding(result),
	}, nil
}

func (s *AgentConfigService) DeleteMcpBinding(ctx context.Context, req *model.DeleteAgentMcpBindingRequest) (*model.DeleteAgentMcpBindingResponse, error) {
	if err := s.domainService.DeleteMcpBinding(ctx, req.GetId()); err != nil {
		return nil, err
	}
	return &model.DeleteAgentMcpBindingResponse{Success: true}, nil
}

func (s *AgentConfigService) GetVoiceConfig(ctx context.Context, req *model.GetAgentVoiceConfigRequest) (*model.GetAgentVoiceConfigResponse, error) {
	config, err := s.domainService.GetVoiceConfig(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.GetAgentVoiceConfigResponse{
		Config: s.toProtoVoiceConfig(config),
	}, nil
}

func (s *AgentConfigService) UpdateVoiceConfig(ctx context.Context, req *model.UpdateAgentVoiceConfigRequest) (*model.UpdateAgentVoiceConfigResponse, error) {
	config := s.fromProtoVoiceConfig(req.GetConfig())
	result, err := s.domainService.UpdateVoiceConfig(ctx, config)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentVoiceConfigResponse{
		Config: s.toProtoVoiceConfig(result),
	}, nil
}

func (s *AgentConfigService) GetToolProfile(ctx context.Context, req *model.GetAgentToolProfileRequest) (*model.GetAgentToolProfileResponse, error) {
	profile, err := s.domainService.GetToolProfile(ctx, req.GetAgentId())
	if err != nil {
		return nil, err
	}

	return &model.GetAgentToolProfileResponse{
		Profile: s.toProtoToolProfile(profile),
	}, nil
}

func (s *AgentConfigService) UpdateToolProfile(ctx context.Context, req *model.UpdateAgentToolProfileRequest) (*model.UpdateAgentToolProfileResponse, error) {
	profile := s.fromProtoToolProfile(req.GetProfile())
	result, err := s.domainService.UpdateToolProfile(ctx, profile)
	if err != nil {
		return nil, err
	}

	return &model.UpdateAgentToolProfileResponse{
		Profile: s.toProtoToolProfile(result),
	}, nil
}

func (s *AgentConfigService) toProtoChatConfig(c *domain.AgentChatConfig) *model.AgentChatConfig {
	return &model.AgentChatConfig{
		AgentId:                c.AgentID,
		HistoryCount:           c.HistoryCount,
		EnableHistoryCount:     c.EnableHistoryCount,
		EnableAutoCreateTopic:  c.EnableAutoCreateTopic,
		AutoCreateTopicThreshold: c.AutoCreateTopicThreshold,
		EnableMaxTokens:        c.EnableMaxTokens,
		EnableStreaming:        c.EnableStreaming,
		EnableContextCompression: c.EnableContextCompression,
		CompressionModelId:     c.CompressionModelID,
		ContextWindowSize:      c.ContextWindowSize,
		SearchMode:             c.SearchMode,
		UseModelBuiltinSearch:  c.UseModelBuiltinSearch,
		UpdatedAt:              timestamppb.New(c.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoChatConfig(c *model.AgentChatConfig) *domain.AgentChatConfig {
	updatedAt := time.Now()
	if c.GetUpdatedAt() != nil {
		updatedAt = c.GetUpdatedAt().AsTime()
	}
	return &domain.AgentChatConfig{
		AgentID:                c.GetAgentId(),
		HistoryCount:           c.GetHistoryCount(),
		EnableHistoryCount:     c.GetEnableHistoryCount(),
		EnableAutoCreateTopic:  c.GetEnableAutoCreateTopic(),
		AutoCreateTopicThreshold: c.GetAutoCreateTopicThreshold(),
		EnableMaxTokens:        c.GetEnableMaxTokens(),
		EnableStreaming:        c.GetEnableStreaming(),
		EnableContextCompression: c.GetEnableContextCompression(),
		CompressionModelID:     c.GetCompressionModelId(),
		ContextWindowSize:      c.GetContextWindowSize(),
		SearchMode:             c.GetSearchMode(),
		UseModelBuiltinSearch:  c.GetUseModelBuiltinSearch(),
		UpdatedAt:              updatedAt,
	}
}

func (s *AgentConfigService) toProtoModelParams(p *domain.AgentModelParams) *model.AgentModelParams {
	return &model.AgentModelParams{
		AgentId:          p.AgentID,
		Temperature:      p.Temperature,
		TopP:             p.TopP,
		FrequencyPenalty: p.FrequencyPenalty,
		PresencePenalty:  p.PresencePenalty,
		MaxTokens:        p.MaxTokens,
		UpdatedAt:        timestamppb.New(p.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoModelParams(p *model.AgentModelParams) *domain.AgentModelParams {
	updatedAt := time.Now()
	if p.GetUpdatedAt() != nil {
		updatedAt = p.GetUpdatedAt().AsTime()
	}
	return &domain.AgentModelParams{
		AgentID:          p.GetAgentId(),
		Temperature:      p.GetTemperature(),
		TopP:             p.GetTopP(),
		FrequencyPenalty: p.GetFrequencyPenalty(),
		PresencePenalty:  p.GetPresencePenalty(),
		MaxTokens:        p.GetMaxTokens(),
		UpdatedAt:        updatedAt,
	}
}

func (s *AgentConfigService) toProtoKnowledgeBinding(b *domain.AgentKnowledgeBinding) *model.AgentKnowledgeBinding {
	return &model.AgentKnowledgeBinding{
		Id:         b.ID,
		AgentId:    b.AgentID,
		ResourceId: b.ResourceID,
		Policy:     b.Policy,
		Enabled:    b.Enabled,
		CreatedAt:  timestamppb.New(b.CreatedAt),
		UpdatedAt:  timestamppb.New(b.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoKnowledgeBinding(b *model.AgentKnowledgeBinding) *domain.AgentKnowledgeBinding {
	createdAt := time.Now()
	if b.GetCreatedAt() != nil {
		createdAt = b.GetCreatedAt().AsTime()
	}
	updatedAt := time.Now()
	if b.GetUpdatedAt() != nil {
		updatedAt = b.GetUpdatedAt().AsTime()
	}
	return &domain.AgentKnowledgeBinding{
		ID:         b.GetId(),
		AgentID:    b.GetAgentId(),
		ResourceID: b.GetResourceId(),
		Policy:     b.GetPolicy(),
		Enabled:    b.GetEnabled(),
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
	}
}

func (s *AgentConfigService) toProtoKnowledgeBindings(bindings []*domain.AgentKnowledgeBinding) []*model.AgentKnowledgeBinding {
	result := make([]*model.AgentKnowledgeBinding, 0, len(bindings))
	for _, b := range bindings {
		result = append(result, s.toProtoKnowledgeBinding(b))
	}
	return result
}

func (s *AgentConfigService) toProtoSkillBinding(b *domain.AgentSkillBinding) *model.AgentSkillBinding {
	return &model.AgentSkillBinding{
		Id:        b.ID,
		AgentId:   b.AgentID,
		SkillId:   b.SkillID,
		Enabled:   b.Enabled,
		CreatedAt: timestamppb.New(b.CreatedAt),
		UpdatedAt: timestamppb.New(b.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoSkillBinding(b *model.AgentSkillBinding) *domain.AgentSkillBinding {
	createdAt := time.Now()
	if b.GetCreatedAt() != nil {
		createdAt = b.GetCreatedAt().AsTime()
	}
	updatedAt := time.Now()
	if b.GetUpdatedAt() != nil {
		updatedAt = b.GetUpdatedAt().AsTime()
	}
	return &domain.AgentSkillBinding{
		ID:        b.GetId(),
		AgentID:   b.GetAgentId(),
		SkillID:   b.GetSkillId(),
		Enabled:   b.GetEnabled(),
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

func (s *AgentConfigService) toProtoSkillBindings(bindings []*domain.AgentSkillBinding) []*model.AgentSkillBinding {
	result := make([]*model.AgentSkillBinding, 0, len(bindings))
	for _, b := range bindings {
		result = append(result, s.toProtoSkillBinding(b))
	}
	return result
}

func (s *AgentConfigService) toProtoMcpBinding(b *domain.AgentMcpBinding) *model.AgentMcpBinding {
	return &model.AgentMcpBinding{
		Id:         b.ID,
		AgentId:    b.AgentID,
		ServerName: b.ServerName,
		Enabled:    b.Enabled,
		CreatedAt:  timestamppb.New(b.CreatedAt),
		UpdatedAt:  timestamppb.New(b.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoMcpBinding(b *model.AgentMcpBinding) *domain.AgentMcpBinding {
	createdAt := time.Now()
	if b.GetCreatedAt() != nil {
		createdAt = b.GetCreatedAt().AsTime()
	}
	updatedAt := time.Now()
	if b.GetUpdatedAt() != nil {
		updatedAt = b.GetUpdatedAt().AsTime()
	}
	return &domain.AgentMcpBinding{
		ID:         b.GetId(),
		AgentID:    b.GetAgentId(),
		ServerName: b.GetServerName(),
		Enabled:    b.GetEnabled(),
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
	}
}

func (s *AgentConfigService) toProtoMcpBindings(bindings []*domain.AgentMcpBinding) []*model.AgentMcpBinding {
	result := make([]*model.AgentMcpBinding, 0, len(bindings))
	for _, b := range bindings {
		result = append(result, s.toProtoMcpBinding(b))
	}
	return result
}

func (s *AgentConfigService) toProtoVoiceConfig(c *domain.AgentVoiceConfig) *model.AgentVoiceConfig {
	return &model.AgentVoiceConfig{
		AgentId:     c.AgentID,
		TtsProvider: c.TtsProvider,
		TtsVoice:    c.TtsVoice,
		TtsSpeed:    c.TtsSpeed,
		TtsAutoRead: c.TtsAutoRead,
		SttProvider: c.SttProvider,
		SttLanguage: c.SttLanguage,
		SttAutoStop: c.SttAutoStop,
		UpdatedAt:   timestamppb.New(c.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoVoiceConfig(c *model.AgentVoiceConfig) *domain.AgentVoiceConfig {
	updatedAt := time.Now()
	if c.GetUpdatedAt() != nil {
		updatedAt = c.GetUpdatedAt().AsTime()
	}
	return &domain.AgentVoiceConfig{
		AgentID:     c.GetAgentId(),
		TtsProvider: c.GetTtsProvider(),
		TtsVoice:    c.GetTtsVoice(),
		TtsSpeed:    c.GetTtsSpeed(),
		TtsAutoRead: c.GetTtsAutoRead(),
		SttProvider: c.GetSttProvider(),
		SttLanguage: c.GetSttLanguage(),
		SttAutoStop: c.GetSttAutoStop(),
		UpdatedAt:   updatedAt,
	}
}

func (s *AgentConfigService) toProtoToolProfile(p *domain.AgentToolProfile) *model.AgentToolProfile {
	return &model.AgentToolProfile{
		AgentId:   p.AgentID,
		Profile:   p.Profile,
		Allow:     p.Allow,
		Deny:      p.Deny,
		UpdatedAt: timestamppb.New(p.UpdatedAt),
	}
}

func (s *AgentConfigService) fromProtoToolProfile(p *model.AgentToolProfile) *domain.AgentToolProfile {
	updatedAt := time.Now()
	if p.GetUpdatedAt() != nil {
		updatedAt = p.GetUpdatedAt().AsTime()
	}
	return &domain.AgentToolProfile{
		AgentID:   p.GetAgentId(),
		Profile:   p.GetProfile(),
		Allow:     p.GetAllow(),
		Deny:      p.GetDeny(),
		UpdatedAt: updatedAt,
	}
}
