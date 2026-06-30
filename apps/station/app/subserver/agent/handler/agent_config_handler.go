package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type AgentConfigHandlers struct {
	configService *service.AgentConfigService
}

func NewAgentConfigHandlers(configService *service.AgentConfigService) *AgentConfigHandlers {
	return &AgentConfigHandlers{configService: configService}
}

func (h *AgentConfigHandlers) HandleListKnowledgeBindings(ctx context.Context, req *model.ListAgentKnowledgeBindingsRequest) (*model.ListAgentKnowledgeBindingsResponse, error) {
	return h.configService.ListKnowledgeBindings(ctx, req)
}

func (h *AgentConfigHandlers) HandleCreateKnowledgeBinding(ctx context.Context, req *model.CreateAgentKnowledgeBindingRequest) (*model.CreateAgentKnowledgeBindingResponse, error) {
	return h.configService.CreateKnowledgeBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleUpdateKnowledgeBinding(ctx context.Context, req *model.UpdateAgentKnowledgeBindingRequest) (*model.UpdateAgentKnowledgeBindingResponse, error) {
	return h.configService.UpdateKnowledgeBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleDeleteKnowledgeBinding(ctx context.Context, req *model.DeleteAgentKnowledgeBindingRequest) (*model.DeleteAgentKnowledgeBindingResponse, error) {
	return h.configService.DeleteKnowledgeBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleListSkillBindings(ctx context.Context, req *model.ListAgentSkillBindingsRequest) (*model.ListAgentSkillBindingsResponse, error) {
	return h.configService.ListSkillBindings(ctx, req)
}

func (h *AgentConfigHandlers) HandleCreateSkillBinding(ctx context.Context, req *model.CreateAgentSkillBindingRequest) (*model.CreateAgentSkillBindingResponse, error) {
	return h.configService.CreateSkillBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleUpdateSkillBinding(ctx context.Context, req *model.UpdateAgentSkillBindingRequest) (*model.UpdateAgentSkillBindingResponse, error) {
	return h.configService.UpdateSkillBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleDeleteSkillBinding(ctx context.Context, req *model.DeleteAgentSkillBindingRequest) (*model.DeleteAgentSkillBindingResponse, error) {
	return h.configService.DeleteSkillBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleListMcpBindings(ctx context.Context, req *model.ListAgentMcpBindingsRequest) (*model.ListAgentMcpBindingsResponse, error) {
	return h.configService.ListMcpBindings(ctx, req)
}

func (h *AgentConfigHandlers) HandleCreateMcpBinding(ctx context.Context, req *model.CreateAgentMcpBindingRequest) (*model.CreateAgentMcpBindingResponse, error) {
	return h.configService.CreateMcpBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleUpdateMcpBinding(ctx context.Context, req *model.UpdateAgentMcpBindingRequest) (*model.UpdateAgentMcpBindingResponse, error) {
	return h.configService.UpdateMcpBinding(ctx, req)
}

func (h *AgentConfigHandlers) HandleDeleteMcpBinding(ctx context.Context, req *model.DeleteAgentMcpBindingRequest) (*model.DeleteAgentMcpBindingResponse, error) {
	return h.configService.DeleteMcpBinding(ctx, req)
}
