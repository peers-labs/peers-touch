// Changelog:
// 2026-04-11 — Phase 3 integration: wired TurnService into TurnHandlers,
//   replaced 501 stub with actual ExecuteTurn call and response mapping.
// 2026-04-11 — Phase 4: added ToolRegistryService dependency for populating
//   AvailableTools from the registered tool names.
// 2026-04-15 — Use generated model.ExecuteTurnRequest / model.ExecuteTurnResponse;
//   map domain turn into model.Turn (proto JSON uses camelCase: finalResponse, turnId, …).
// 2026-06-17 — Agent rebuild P0-1: added local tool result ingress so Desktop
//   can return MCP execution results to a live Station turn stream.

package handler

import (
	"context"
	"encoding/json"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TurnHandlers struct {
	turnService  *service.TurnService
	toolRegistry *service.ToolRegistryService
}

type localToolResultRequest struct {
	TurnID  string `json:"turn_id"`
	CallID  string `json:"call_id"`
	Content string `json:"content"`
	IsError bool   `json:"is_error"`
}

func NewTurnHandlers(turnService *service.TurnService, toolRegistry *service.ToolRegistryService) *TurnHandlers {
	return &TurnHandlers{turnService: turnService, toolRegistry: toolRegistry}
}

func (h *TurnHandlers) HandleExecuteTurn(ctx context.Context, req *model.ExecuteTurnRequest) (*model.ExecuteTurnResponse, error) {
	if req.GetConversationId() == "" || req.GetAgentId() == "" || req.GetUserInput() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"conversation_id, agent_id, and user_input are required", nil))
	}

	config := h.turnConfigFromRequest(req, nil)
	turn, err := h.turnService.ExecuteTurn(ctx, config, req.GetUserInput())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.ExecuteTurnResponse{
		Turn: domainTurnToProto(turn),
	}, nil
}

func (h *TurnHandlers) HandleExecuteTurnStream(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input model.ExecuteTurnRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": "invalid turn stream request",
		})
		return nil
	}
	input.Stream = true
	if input.GetConversationId() == "" || input.GetAgentId() == "" || input.GetUserInput() == "" {
		_ = writeTurnStreamEvent(resp, "error", map[string]any{
			"type":  "error",
			"error": "conversation_id, agent_id, and user_input are required",
		})
		return nil
	}

	events := make(chan service.TurnEvent, 32)
	done := make(chan turnStreamResult, 1)
	config := h.turnConfigFromRequest(&input, func(eventCtx context.Context, event service.TurnEvent) {
		select {
		case events <- event:
		case <-eventCtx.Done():
		}
	})

	go func() {
		turn, err := h.turnService.ExecuteTurn(ctx, config, input.GetUserInput())
		done <- turnStreamResult{turn: domainTurnToProto(turn), err: err}
		close(events)
	}()

	for {
		select {
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			_ = writeTurnStreamEvent(resp, event.Type, event)
		case result := <-done:
			if result.err != nil {
				_ = writeTurnStreamEvent(resp, "error", map[string]any{
					"type":  "error",
					"error": result.err.Error(),
				})
				return nil
			}
			_ = writeTurnStreamEvent(resp, "done", map[string]any{
				"type": "done",
				"turn": result.turn,
			})
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}

func (h *TurnHandlers) HandleLocalToolResult(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "application/json")

	var input localToolResultRequest
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"invalid local tool result request"}`))
		return nil
	}
	if input.TurnID == "" || input.CallID == "" {
		resp.WriteHeader(400)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"turn_id and call_id are required"}`))
		return nil
	}
	if err := h.turnService.SubmitLocalToolResult(service.LocalToolResult{
		TurnID:  input.TurnID,
		CallID:  input.CallID,
		Content: input.Content,
		IsError: input.IsError,
	}); err != nil {
		resp.WriteHeader(404)
		_, _ = resp.Write([]byte(`{"ok":false,"error":"local tool waiter not found"}`))
		return nil
	}

	_, _ = resp.Write([]byte(`{"ok":true}`))
	return nil
}

type turnStreamResult struct {
	turn *model.Turn
	err  error
}

func (h *TurnHandlers) turnConfigFromRequest(req *model.ExecuteTurnRequest, sink service.TurnEventSink) *service.TurnConfig {
	contextWindowSize := int(req.GetContextWindowSize())
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}

	maxRetries := int(req.GetMaxRetries())
	if maxRetries <= 0 {
		maxRetries = 3
	}

	return &service.TurnConfig{
		AgentID:            req.GetAgentId(),
		ConversationID:     req.GetConversationId(),
		Identity:           req.GetIdentity(),
		AgentConfigPrompt:  req.GetAgentConfigPrompt(),
		Platform:           req.GetPlatform(),
		AvailableTools:     h.toolRegistry.ToolNames(),
		ContextWindowSize:  contextWindowSize,
		MaxRetries:         maxRetries,
		Provider:           req.GetProvider(),
		Model:              req.GetModel(),
		WorkspaceRoot:      req.GetWorkspaceRoot(),
		KnowledgeResources: knowledgeResourcesFromRequest(req),
		EventSink:          sink,
	}
}

func knowledgeResourcesFromRequest(req *model.ExecuteTurnRequest) []domain.KnowledgeResource {
	resources := req.GetKnowledgeResources()
	if len(resources) == 0 {
		return nil
	}
	out := make([]domain.KnowledgeResource, 0, len(resources))
	for _, resource := range resources {
		if resource.GetSource() == "" {
			continue
		}
		out = append(out, domain.KnowledgeResource{
			ResourceID: resource.GetResourceId(),
			AgentID:    resource.GetAgentId(),
			Type:       knowledgeResourceTypeFromProto(resource.GetType()),
			Title:      resource.GetTitle(),
			Source:     resource.GetSource(),
			Policy:     knowledgeResourcePolicyFromProto(resource.GetPolicy()),
			Status:     resource.GetStatus().String(),
		})
	}
	return out
}

func knowledgeResourceTypeFromProto(value model.KnowledgeResourceType) domain.KnowledgeResourceType {
	switch value {
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_FOLDER:
		return domain.KnowledgeResourceTypeFolder
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_PROJECT:
		return domain.KnowledgeResourceTypeProject
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_URL:
		return domain.KnowledgeResourceTypeURL
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_NOTEBOOK:
		return domain.KnowledgeResourceTypeNotebook
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_WORKSPACE:
		return domain.KnowledgeResourceTypeWorkspace
	default:
		return domain.KnowledgeResourceTypeDocument
	}
}

func knowledgeResourcePolicyFromProto(value model.KnowledgeResourcePolicy) domain.KnowledgeResourcePolicy {
	switch value {
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_AUTO:
		return domain.KnowledgeResourcePolicyAuto
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_ALWAYS:
		return domain.KnowledgeResourcePolicyAlways
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_DISABLED:
		return domain.KnowledgeResourcePolicyDisabled
	default:
		return domain.KnowledgeResourcePolicyManual
	}
}

func writeTurnStreamEvent(resp server.Response, event string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := resp.Write([]byte("event: " + event + "\n")); err != nil {
		return err
	}
	if _, err := resp.Write([]byte("data: " + string(data) + "\n\n")); err != nil {
		return err
	}
	return nil
}

func domainTurnToProto(t *domain.Turn) *model.Turn {
	if t == nil {
		return nil
	}
	out := &model.Turn{
		TurnId:         t.TurnID,
		ConversationId: t.ConversationID,
		AgentId:        t.AgentID,
		UserInput:      t.UserInput,
		FinalResponse:  t.FinalResponse,
		ToolIterations: int32(t.ToolIterations),
		Status:         domainTurnStatusToProto(t.Status),
	}
	if !t.StartedAt.IsZero() {
		out.StartedAt = timestamppb.New(t.StartedAt)
	}
	if t.EndedAt != nil && !t.EndedAt.IsZero() {
		out.EndedAt = timestamppb.New(*t.EndedAt)
	}
	return out
}

func domainTurnStatusToProto(s domain.TurnStatus) model.TurnStatus {
	switch s {
	case domain.TurnStatusRunning:
		return model.TurnStatus_TURN_STATUS_RUNNING
	case domain.TurnStatusCompleted:
		return model.TurnStatus_TURN_STATUS_COMPLETED
	case domain.TurnStatusFailed:
		return model.TurnStatus_TURN_STATUS_FAILED
	case domain.TurnStatusInterrupted:
		return model.TurnStatus_TURN_STATUS_INTERRUPTED
	default:
		return model.TurnStatus_TURN_STATUS_UNSPECIFIED
	}
}
