package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type RuntimeEvidenceHandlers struct {
	runtimeEvidence *service.RuntimeEvidenceService
	readiness       *service.RuntimeReadinessService
}

func NewRuntimeEvidenceHandlers(
	runtimeEvidence *service.RuntimeEvidenceService,
	readiness *service.RuntimeReadinessService,
) *RuntimeEvidenceHandlers {
	return &RuntimeEvidenceHandlers{
		runtimeEvidence: runtimeEvidence,
		readiness:       readiness,
	}
}

func (h *RuntimeEvidenceHandlers) HandleEffectiveRuntimeProfile(
	ctx context.Context,
	req *model.GetEffectiveRuntimeProfileRequest,
) (*model.GetEffectiveRuntimeProfileResponse, error) {
	snapshot, err := h.runtimeEvidence.EffectiveProfile(
		ctx,
		subjectActorID(ctx),
		req.GetAgentId(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetEffectiveRuntimeProfileResponse{Snapshot: snapshot}, nil
}

func (h *RuntimeEvidenceHandlers) HandleRuntimeActivity(
	ctx context.Context,
	req *model.GetRuntimeActivityRequest,
) (*model.GetRuntimeActivityResponse, error) {
	snapshot, err := h.runtimeEvidence.Activity(
		ctx,
		subjectActorID(ctx),
		req.GetRuntimeKind(),
		req.GetRuntimeId(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetRuntimeActivityResponse{Snapshot: snapshot}, nil
}

func (h *RuntimeEvidenceHandlers) HandleCapabilityReadiness(
	ctx context.Context,
	req *model.GetCapabilityReadinessRequest,
) (*model.GetCapabilityReadinessResponse, error) {
	snapshot, err := h.readiness.Get(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetCapabilityReadinessResponse{Snapshot: snapshot}, nil
}
