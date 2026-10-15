package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type ProviderOperationsHandlers struct {
	operations *service.ProviderOperationsService
}

func NewProviderOperationsHandlers(operations *service.ProviderOperationsService) *ProviderOperationsHandlers {
	return &ProviderOperationsHandlers{operations: operations}
}

func (h *ProviderOperationsHandlers) HandleCheck(
	ctx context.Context, request *model.CheckProviderRequest,
) (*model.CheckProviderResponse, error) {
	result, err := h.operations.Check(ctx, subjectActorID(ctx), request)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return result, nil
}

func (h *ProviderOperationsHandlers) HandleDiscover(
	ctx context.Context, request *model.DiscoverProviderModelsRequest,
) (*model.DiscoverProviderModelsResponse, error) {
	result, err := h.operations.Discover(ctx, subjectActorID(ctx), request)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return result, nil
}
