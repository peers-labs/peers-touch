package service

import (
	"context"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/externalruntime"
)

func (s *TurnService) executeExternalRuntimeTurn(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	systemPrompt string,
	userInput string,
) (string, []domain.ProviderCallRecord, bool, error) {
	if s.externalRuntime == nil {
		return "", nil, false, errcode.NewRuntimeUnavailable(
			"external_agent",
			"adapter_unavailable",
		)
	}
	if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
		return "", nil, false, err
	}
	if err := s.reserveProviderAttempt(ctx, config); err != nil {
		return "", nil, false, err
	}

	startedAt := time.Now()
	result, err := s.externalRuntime.ExecuteTurn(
		ctx,
		ExternalRuntimeTurnRequest{
			ActorPTID:        config.ActorID,
			AgentID:          config.AgentID,
			ConversationID:   config.ConversationID,
			AttemptID:        config.AttemptID,
			RuntimeProfileID: config.RuntimeProfileID,
			SystemPrompt:     systemPrompt,
			UserInput:        userInput,
		},
		func(deltaCtx context.Context, delta externalruntime.Delta) error {
			event := TurnEvent{
				Type:  delta.Type,
				Stage: "external_runtime_delta",
				Text:  delta.Content,
			}
			if delta.Type == "external_activity" {
				event.Text = ""
				event.Result = delta.Content
				event.Stage = "external_runtime_activity"
			}
			return s.emitTurnEvent(deltaCtx, config, turnID, event)
		},
	)
	call := domain.ProviderCallRecord{
		Provider: config.Provider,
		Model:    config.Model,
		Latency:  time.Since(startedAt),
	}
	if err != nil {
		return "", []domain.ProviderCallRecord{call}, false, err
	}
	if result == nil {
		return "", []domain.ProviderCallRecord{call}, false, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"external runtime returned no result",
			nil,
		)
	}
	return result.Content, []domain.ProviderCallRecord{call}, result.Streamed, nil
}
