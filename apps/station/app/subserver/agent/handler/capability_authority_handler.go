package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

// CapabilityAuthorityHandlers expose the W8a canonical catalog, binding, and
// readiness authority.
type CapabilityAuthorityHandlers struct {
	authority *service.CapabilityAuthorityService
	readiness *service.CapabilityAuthorityReadinessService
}

func NewCapabilityAuthorityHandlers(
	authority *service.CapabilityAuthorityService,
	readiness *service.CapabilityAuthorityReadinessService,
) *CapabilityAuthorityHandlers {
	return &CapabilityAuthorityHandlers{
		authority: authority,
		readiness: readiness,
	}
}

func (h *CapabilityAuthorityHandlers) HandleListManifests(
	ctx context.Context,
	req *model.ListCapabilityManifestsRequest,
) (*model.ListCapabilityManifestsResponse, error) {
	manifests, err := h.authority.ListManifests(
		ctx,
		subjectActorID(ctx),
		req.GetSourceKinds(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListCapabilityManifestsResponse{Manifests: manifests}, nil
}

func (h *CapabilityAuthorityHandlers) HandleRetireManifest(
	ctx context.Context,
	req *model.RetireCapabilityManifestRequest,
) (*model.RetireCapabilityManifestResponse, error) {
	manifest, err := h.authority.RetireManifest(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.RetireCapabilityManifestResponse{Manifest: manifest}, nil
}

func (h *CapabilityAuthorityHandlers) HandleListBindings(
	ctx context.Context,
	req *model.ListAgentCapabilityBindingsRequest,
) (*model.ListAgentCapabilityBindingsResponse, error) {
	bindings, err := h.authority.ListBindings(
		ctx, subjectActorID(ctx), req.GetAgentId(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListAgentCapabilityBindingsResponse{Bindings: bindings}, nil
}

func (h *CapabilityAuthorityHandlers) HandleUpsertBinding(
	ctx context.Context,
	req *model.UpsertAgentCapabilityBindingRequest,
) (*model.UpsertAgentCapabilityBindingResponse, error) {
	binding, err := h.authority.UpsertBinding(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpsertAgentCapabilityBindingResponse{Binding: binding}, nil
}

func (h *CapabilityAuthorityHandlers) HandleDeleteBinding(
	ctx context.Context,
	req *model.DeleteAgentCapabilityBindingRequest,
) (*model.DeleteAgentCapabilityBindingResponse, error) {
	binding, err := h.authority.DeleteBinding(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.DeleteAgentCapabilityBindingResponse{Binding: binding}, nil
}

func (h *CapabilityAuthorityHandlers) HandleReadiness(
	ctx context.Context,
	req *model.GetCapabilityReadinessRequest,
) (*model.GetCapabilityReadinessResponse, error) {
	snapshot, err := h.readiness.Get(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetCapabilityReadinessResponse{Snapshot: snapshot}, nil
}
