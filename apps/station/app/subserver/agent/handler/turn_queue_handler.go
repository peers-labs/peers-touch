package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type TurnQueueHandlers struct {
	admission *service.TurnAdmissionService
}

func NewTurnQueueHandlers(admission *service.TurnAdmissionService) *TurnQueueHandlers {
	return &TurnQueueHandlers{admission: admission}
}

func (h *TurnQueueHandlers) HandleListQueuedTurns(
	ctx context.Context,
	req *model.ListQueuedTurnsRequest,
) (*model.ListQueuedTurnsResponse, error) {
	response, err := h.admission.List(
		ctx,
		subjectActorID(ctx),
		req.GetConversationId(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *TurnQueueHandlers) HandleCancelQueuedTurn(
	ctx context.Context,
	req *model.CancelQueuedTurnRequest,
) (*model.CancelQueuedTurnResponse, error) {
	response, err := h.admission.Cancel(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
