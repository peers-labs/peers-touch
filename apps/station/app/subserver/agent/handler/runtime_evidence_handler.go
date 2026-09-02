package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type RuntimeEvidenceHandlers struct {
	runtimeEvidence *service.RuntimeEvidenceService
}

func NewRuntimeEvidenceHandlers(
	runtimeEvidence *service.RuntimeEvidenceService,
) *RuntimeEvidenceHandlers {
	return &RuntimeEvidenceHandlers{
		runtimeEvidence: runtimeEvidence,
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
