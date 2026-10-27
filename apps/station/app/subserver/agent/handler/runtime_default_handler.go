package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func (h *ProviderHandlers) HandleGetRuntimeDefault(
	ctx context.Context,
	_ *model.GetRuntimeDefaultRequest,
) (*model.GetRuntimeDefaultResponse, error) {
	row, found, err := h.runtimeDefaults.GetRuntimeDefault(ctx, subjectActorID(ctx))
	if err != nil {
		return nil, toHandlerError(err)
	}
	resp := &model.GetRuntimeDefaultResponse{}
	if found {
		resp.RuntimeDefault = &model.RuntimeDefault{
			ProviderId: row.DefaultProviderID,
			ModelId:    row.DefaultModelID,
			Revision:   row.Revision,
		}
	}
	return resp, nil
}

func (h *ProviderHandlers) HandleSetRuntimeDefault(
	ctx context.Context,
	req *model.SetRuntimeDefaultRequest,
) (*model.SetRuntimeDefaultResponse, error) {
	actorPTID := subjectActorID(ctx)
	providerID := strings.TrimSpace(req.GetProviderId())
	modelID := strings.TrimSpace(req.GetModelId())
	if providerID == "" || modelID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider_id and model_id are required", nil)
	}

	available, err := h.admissionResolver.ListAvailableModels(ctx, actorPTID)
	if err != nil {
		return nil, toHandlerError(err)
	}
	matched := false
	for _, candidate := range available {
		if candidate.ID == modelID && candidate.ProviderID == providerID && candidate.Enabled {
			matched = true
			break
		}
	}
	if !matched {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"selected model is not available for this actor", nil)
	}

	row, err := h.runtimeDefaults.SetRuntimeDefault(
		ctx,
		actorPTID,
		providerID,
		modelID,
		req.GetExpectedRevision(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.SetRuntimeDefaultResponse{
		RuntimeDefault: &model.RuntimeDefault{
			ProviderId: row.DefaultProviderID,
			ModelId:    row.DefaultModelID,
			Revision:   row.Revision,
		},
	}, nil
}
