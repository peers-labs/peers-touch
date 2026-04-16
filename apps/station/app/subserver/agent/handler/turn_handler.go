// Changelog:
// 2026-04-11 — Phase 3 integration: wired TurnService into TurnHandlers,
//   replaced 501 stub with actual ExecuteTurn call and response mapping.
// 2026-04-11 — Phase 4: added ToolRegistryService dependency for populating
//   AvailableTools from the registered tool names.
// 2026-04-15 — Use generated model.ExecuteTurnRequest / model.ExecuteTurnResponse;
//   map domain turn into model.Turn (proto JSON uses camelCase: finalResponse, turnId, …).

package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TurnHandlers struct {
	turnService  *service.TurnService
	toolRegistry *service.ToolRegistryService
}

func NewTurnHandlers(turnService *service.TurnService, toolRegistry *service.ToolRegistryService) *TurnHandlers {
	return &TurnHandlers{turnService: turnService, toolRegistry: toolRegistry}
}

func (h *TurnHandlers) HandleExecuteTurn(ctx context.Context, req *model.ExecuteTurnRequest) (*model.ExecuteTurnResponse, error) {
	if req.GetConversationId() == "" || req.GetAgentId() == "" || req.GetUserInput() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"conversation_id, agent_id, and user_input are required", nil))
	}

	contextWindowSize := int(req.GetContextWindowSize())
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}

	maxRetries := int(req.GetMaxRetries())
	if maxRetries <= 0 {
		maxRetries = 3
	}

	config := &service.TurnConfig{
		AgentID:           req.GetAgentId(),
		ConversationID:    req.GetConversationId(),
		Identity:          req.GetIdentity(),
		AgentConfigPrompt: req.GetAgentConfigPrompt(),
		Platform:          req.GetPlatform(),
		AvailableTools:    h.toolRegistry.ToolNames(),
		ContextWindowSize: contextWindowSize,
		MaxRetries:        maxRetries,
		Provider:          req.GetProvider(),
		Model:             req.GetModel(),
		WorkspaceRoot:     req.GetWorkspaceRoot(),
	}

	turn, err := h.turnService.ExecuteTurn(ctx, config, req.GetUserInput())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.ExecuteTurnResponse{
		Turn: domainTurnToProto(turn),
	}, nil
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
