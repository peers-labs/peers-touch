// Changelog:
// 2026-04-11 — Phase 3 integration: wired TurnService into TurnHandlers,
//   replaced 501 stub with actual ExecuteTurn call and response mapping.
// 2026-04-11 — Phase 4: added ToolRegistryService dependency for populating
//   AvailableTools from the registered tool names.

package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type TurnHandlers struct {
	turnService  *service.TurnService
	toolRegistry *service.ToolRegistryService
}

func NewTurnHandlers(turnService *service.TurnService, toolRegistry *service.ToolRegistryService) *TurnHandlers {
	return &TurnHandlers{turnService: turnService, toolRegistry: toolRegistry}
}

type ExecuteTurnRequest struct {
	ConversationID string `json:"conversation_id"`
	AgentID        string `json:"agent_id"`
	UserInput      string `json:"user_input"`
	Stream         bool   `json:"stream"`

	Provider          string `json:"provider,omitempty"`
	Model             string `json:"model,omitempty"`
	Identity          string `json:"identity,omitempty"`
	AgentConfigPrompt string `json:"agent_config_prompt,omitempty"`
	Platform          string `json:"platform,omitempty"`
	WorkspaceRoot     string `json:"workspace_root,omitempty"`
	ContextWindowSize int    `json:"context_window_size,omitempty"`
	MaxRetries        int    `json:"max_retries,omitempty"`
}

type ExecuteTurnResponse struct {
	TurnID         string `json:"turn_id"`
	Response       string `json:"response"`
	ToolIterations int    `json:"tool_iterations"`
	Status         string `json:"status"`
}

func (h *TurnHandlers) HandleExecuteTurn(ctx context.Context, req *ExecuteTurnRequest) (*ExecuteTurnResponse, error) {

	if req.ConversationID == "" || req.AgentID == "" || req.UserInput == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400,
			"conversation_id, agent_id, and user_input are required", nil))
	}

	contextWindowSize := req.ContextWindowSize
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}

	config := &service.TurnConfig{
		AgentID:           req.AgentID,
		ConversationID:    req.ConversationID,
		Identity:          req.Identity,
		AgentConfigPrompt: req.AgentConfigPrompt,
		Platform:          req.Platform,
		AvailableTools:    h.toolRegistry.ToolNames(),
		ContextWindowSize: contextWindowSize,
		MaxRetries:        req.MaxRetries,
		Provider:          req.Provider,
		Model:             req.Model,
		WorkspaceRoot:     req.WorkspaceRoot,
	}

	turn, err := h.turnService.ExecuteTurn(ctx, config, req.UserInput)
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &ExecuteTurnResponse{
		TurnID:         turn.TurnID,
		Response:       turn.FinalResponse,
		ToolIterations: turn.ToolIterations,
		Status:         string(turn.Status),
	}, nil
}
