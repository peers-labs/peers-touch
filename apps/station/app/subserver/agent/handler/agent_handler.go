package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type AgentHandlers struct {
	agentService *service.AgentService
}

func NewAgentHandlers(agentService *service.AgentService) *AgentHandlers {
	return &AgentHandlers{agentService: agentService}
}

func (h *AgentHandlers) HandleListAgents(ctx context.Context, req *model.ListAgentsRequest) (*model.ListAgentsResponse, error) {
	agents, total, err := h.agentService.ListAgents(ctx, domain.AgentListOptions{
		ActorID:    subjectActorID(ctx),
		Visibility: protoAgentVisibilityToDomain(req.GetVisibility()),
		Page:       int(req.GetPage()),
		PageSize:   int(req.GetPageSize()),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	resp := &model.ListAgentsResponse{
		Agents: make([]*model.Agent, 0, len(agents)),
		Total:  int32(total),
	}
	for i := range agents {
		resp.Agents = append(resp.Agents, domainAgentToProto(&agents[i]))
	}
	return resp, nil
}

func (h *AgentHandlers) HandleGetAgent(ctx context.Context, req *model.GetAgentRequest) (*model.GetAgentResponse, error) {
	agent, err := h.agentService.GetAgent(ctx, subjectActorID(ctx), req.GetAgentId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetAgentResponse{Agent: domainAgentToProto(agent)}, nil
}

func (h *AgentHandlers) HandleCreateAgent(ctx context.Context, req *model.CreateAgentRequest) (*model.CreateAgentResponse, error) {
	agent, err := h.agentService.CreateAgent(ctx, domain.AgentUpsertOptions{
		ActorID:     subjectActorID(ctx),
		Name:        req.GetName(),
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		ProviderID:  req.GetProviderId(),
		ModelName:   req.GetModelName(),
		Effort:      req.GetEffort(),
		Visibility:  protoAgentVisibilityToDomain(req.GetVisibility()),
		ConfigJSON:  req.GetConfigJson(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateAgentResponse{Agent: domainAgentToProto(agent)}, nil
}

func (h *AgentHandlers) HandleUpdateAgent(ctx context.Context, req *model.UpdateAgentRequest) (*model.UpdateAgentResponse, error) {
	agent, err := h.agentService.UpdateAgent(ctx, domain.AgentUpsertOptions{
		ActorID:     subjectActorID(ctx),
		AgentID:     req.GetAgentId(),
		Name:        req.GetName(),
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		ProviderID:  req.GetProviderId(),
		ModelName:   req.GetModelName(),
		Effort:      req.GetEffort(),
		Visibility:  protoAgentVisibilityToDomain(req.GetVisibility()),
		ConfigJSON:  req.GetConfigJson(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateAgentResponse{Agent: domainAgentToProto(agent)}, nil
}

func (h *AgentHandlers) HandleDeleteAgent(ctx context.Context, req *model.DeleteAgentRequest) (*model.DeleteAgentResponse, error) {
	if err := h.agentService.DeleteAgent(ctx, subjectActorID(ctx), req.GetAgentId()); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.DeleteAgentResponse{Success: true}, nil
}

func subjectActorID(ctx context.Context) string {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return ""
	}
	return subject.ID
}

func protoAgentVisibilityToDomain(visibility model.AgentVisibility) domain.AgentVisibility {
	if visibility == model.AgentVisibility_AGENT_VISIBILITY_WORKSPACE {
		return domain.AgentVisibilityWorkspace
	}
	return domain.AgentVisibilityPrivate
}

func domainAgentVisibilityToProto(visibility domain.AgentVisibility) model.AgentVisibility {
	if visibility == domain.AgentVisibilityWorkspace {
		return model.AgentVisibility_AGENT_VISIBILITY_WORKSPACE
	}
	return model.AgentVisibility_AGENT_VISIBILITY_PRIVATE
}

func domainAgentToProto(agent *domain.Agent) *model.Agent {
	if agent == nil {
		return nil
	}
	return &model.Agent{
		AgentId:      agent.AgentID,
		Name:         agent.Name,
		Title:        agent.Title,
		Description:  agent.Description,
		ProviderId:   agent.ProviderID,
		ModelName:    agent.ModelName,
		Effort:       agent.Effort,
		Visibility:   domainAgentVisibilityToProto(agent.Visibility),
		OwnerActorId: agent.OwnerActorID,
		ConfigJson:   agent.ConfigJSON,
		CreatedAt:    timestamppb.New(agent.CreatedAt),
		UpdatedAt:    timestamppb.New(agent.UpdatedAt),
	}
}
