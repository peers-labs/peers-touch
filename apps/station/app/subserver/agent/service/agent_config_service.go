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
