package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type CapabilityAcceptanceScenarioHandlers struct {
	scenarios *service.CapabilityAcceptanceScenarioService
}

func NewCapabilityAcceptanceScenarioHandlers(
	scenarios *service.CapabilityAcceptanceScenarioService,
) *CapabilityAcceptanceScenarioHandlers {
	return &CapabilityAcceptanceScenarioHandlers{scenarios: scenarios}
}

func (h *CapabilityAcceptanceScenarioHandlers) HandlePrepare(
	ctx context.Context,
	req *model.PrepareCapabilityAcceptanceScenarioRequest,
) (*model.PrepareCapabilityAcceptanceScenarioResponse, error) {
	response, err := h.scenarios.Prepare(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityAcceptanceScenarioHandlers) HandleArmExecutorHook(
	ctx context.Context,
	req *model.ArmCapabilityAcceptanceExecutorHookRequest,
) (*model.ArmCapabilityAcceptanceExecutorHookResponse, error) {
	response, err := h.scenarios.ArmExecutorHook(subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityAcceptanceScenarioHandlers) HandleWaitBarrier(
	ctx context.Context,
	req *model.WaitCapabilityAcceptanceBarrierRequest,
) (*model.WaitCapabilityAcceptanceBarrierResponse, error) {
	response, err := h.scenarios.WaitBarrier(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityAcceptanceScenarioHandlers) HandleReachExecutorBarrier(
	ctx context.Context,
	req *model.ReachCapabilityAcceptanceExecutorBarrierRequest,
) (*model.ReachCapabilityAcceptanceExecutorBarrierResponse, error) {
	response, err := h.scenarios.ReachExecutorBarrier(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityAcceptanceScenarioHandlers) HandleReleaseBarrier(
	ctx context.Context,
	req *model.ReleaseCapabilityAcceptanceBarrierRequest,
) (*model.ReleaseCapabilityAcceptanceBarrierResponse, error) {
	response, err := h.scenarios.ReleaseBarrier(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityAcceptanceScenarioHandlers) HandleInterruptWorker(
	ctx context.Context,
	req *model.InterruptCapabilityAcceptanceWorkerRequest,
) (*model.InterruptCapabilityAcceptanceWorkerResponse, error) {
	response, err := h.scenarios.InterruptWorker(subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityAcceptanceScenarioHandlers) HandleCleanup(
	ctx context.Context,
	req *model.CleanupCapabilityAcceptanceScenarioRequest,
) (*model.CleanupCapabilityAcceptanceScenarioResponse, error) {
	response, err := h.scenarios.Cleanup(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}
