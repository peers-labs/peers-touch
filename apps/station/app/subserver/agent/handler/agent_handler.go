package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type AgentHandlers struct {
	agentService *service.AgentService
	eventBus     domain.EventBus
}

func NewAgentHandlers(agentService *service.AgentService, eventBus domain.EventBus) *AgentHandlers {
	return &AgentHandlers{agentService: agentService, eventBus: eventBus}
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
	configJSON := mergeConfigExtras(req.GetConfigJson(), "", "")
	agent, err := h.agentService.CreateAgent(ctx, domain.AgentUpsertOptions{
		ActorID:     subjectActorID(ctx),
		Name:        req.GetName(),
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		ProviderID:  req.GetProviderId(),
		ModelName:   req.GetModelName(),
		Effort:      req.GetEffort(),
		Visibility:  protoAgentVisibilityToDomain(req.GetVisibility()),
		ConfigJSON:  configJSON,
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	h.publishAgentEvent(ctx, domain.EventTypeAgentCreated, agent)
	return &model.CreateAgentResponse{Agent: domainAgentToProto(agent)}, nil
}

func (h *AgentHandlers) HandleCreateAgentRaw(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")
	var body struct {
		Name              string `json:"name"`
		Title             string `json:"title"`
		Description       string `json:"description"`
		Provider          string `json:"provider"`
		ProviderID        string `json:"provider_id"`
		Model             string `json:"model"`
		ModelName         string `json:"model_name"`
		Effort            string `json:"effort"`
		Visibility        string `json:"visibility"`
		Identity          string `json:"identity"`
		SoulMd            string `json:"soul_md"`
		SoulMd2           string `json:"soulMd"`
		AgentConfigPrompt string `json:"agent_config_prompt"`
		AgentsMd          string `json:"agents_md"`
		AgentsMd2         string `json:"agentsMd"`
		ConfigJSON        string `json:"config_json"`
		ConfigJson        string `json:"configJson"`
		Enabled           bool   `json:"enabled"`
		PermissionMode    string `json:"permission_mode"`
	}
	if err := json.Unmarshal(req.Body(), &body); err != nil {
		resp.WriteHeader(400)
		_ = json.NewEncoder(resp).Encode(map[string]interface{}{"error": "invalid JSON"})
		return nil
	}
	provider := body.ProviderID
	if provider == "" {
		provider = body.Provider
	}
	modelName := body.ModelName
	if modelName == "" {
		modelName = body.Model
	}
	identity := body.Identity
	if identity == "" {
		identity = body.SoulMd
	}
	if identity == "" {
		identity = body.SoulMd2
	}
	agentPrompt := body.AgentConfigPrompt
	if agentPrompt == "" {
		agentPrompt = body.AgentsMd
	}
	if agentPrompt == "" {
		agentPrompt = body.AgentsMd2
	}
	cfgJSON := body.ConfigJSON
	if cfgJSON == "" {
		cfgJSON = body.ConfigJson
	}
	cfgJSON = mergeConfigExtras(cfgJSON, identity, agentPrompt)

	visibility := domain.AgentVisibilityPrivate
	if body.Visibility == "workspace" || body.Visibility == "AGENT_VISIBILITY_WORKSPACE" {
		visibility = domain.AgentVisibilityWorkspace
	}
	agent, err := h.agentService.CreateAgent(ctx, domain.AgentUpsertOptions{
		ActorID:     subjectActorID(ctx),
		Name:        body.Name,
		Title:       body.Title,
		Description: body.Description,
		ProviderID:  provider,
		ModelName:   modelName,
		Effort:      body.Effort,
		Visibility:  visibility,
		ConfigJSON:  cfgJSON,
	})
	if err != nil {
		resp.WriteHeader(500)
		_ = json.NewEncoder(resp).Encode(map[string]interface{}{"error": err.Error()})
		return nil
	}
	h.publishAgentEvent(ctx, domain.EventTypeAgentCreated, agent)
	_ = json.NewEncoder(resp).Encode(map[string]interface{}{"agent": domainAgentToMap(agent)})
	return nil
}

func mergeConfigExtras(baseJSON, identity, agentPrompt string) string {
	var cfg map[string]interface{}
	if baseJSON != "" {
		_ = json.Unmarshal([]byte(baseJSON), &cfg)
	}
	if cfg == nil {
		cfg = make(map[string]interface{})
	}
	if identity != "" {
		cfg["identity"] = identity
		cfg["soulMd"] = identity
	}
	if agentPrompt != "" {
		cfg["agentConfigPrompt"] = agentPrompt
		cfg["agentsMd"] = agentPrompt
	}
	out, _ := json.Marshal(cfg)
	return string(out)
}

func domainAgentToMap(agent *domain.Agent) map[string]interface{} {
	if agent == nil {
		return nil
	}
	return map[string]interface{}{
		"agent_id":       agent.AgentID,
		"name":           agent.Name,
		"title":          agent.Title,
		"description":    agent.Description,
		"provider_id":    agent.ProviderID,
		"model_name":     agent.ModelName,
		"effort":         agent.Effort,
		"visibility":     agent.Visibility,
		"owner_actor_id": agent.OwnerActorID,
		"config_json":    agent.ConfigJSON,
		"version":        agent.Version,
		"created_at":     agent.CreatedAt,
		"updated_at":     agent.UpdatedAt,
	}
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
		Version:     req.GetVersion(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	h.publishAgentEvent(ctx, domain.EventTypeAgentUpdated, agent)
	return &model.UpdateAgentResponse{Agent: domainAgentToProto(agent)}, nil
}

func (h *AgentHandlers) HandleDeleteAgent(ctx context.Context, req *model.DeleteAgentRequest) (*model.DeleteAgentResponse, error) {
	if err := h.agentService.DeleteAgent(ctx, subjectActorID(ctx), req.GetAgentId()); err != nil {
		return nil, toHandlerError(err)
	}
	h.publishAgentEvent(ctx, domain.EventTypeAgentDeleted, &domain.Agent{AgentID: req.GetAgentId(), OwnerActorID: subjectActorID(ctx)})
	return &model.DeleteAgentResponse{Success: true}, nil
}

func (h *AgentHandlers) publishAgentEvent(ctx context.Context, eventType domain.EventType, agent *domain.Agent) {
	if h.eventBus == nil || agent == nil {
		return
	}
	_ = h.eventBus.Publish(ctx, domain.DomainEvent{
		EventID:    fmt.Sprintf("evt-%d", time.Now().UnixNano()),
		EventType:  string(eventType),
		OccurredAt: time.Now(),
		ActorID:    agent.OwnerActorID,
		Payload:    domainAgentToProto(agent),
		Metadata: map[string]string{
			"agent_id": agent.AgentID,
		},
	})
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
		Version:      agent.Version,
		CreatedAt:    timestamppb.New(agent.CreatedAt),
		UpdatedAt:    timestamppb.New(agent.UpdatedAt),
	}
}
