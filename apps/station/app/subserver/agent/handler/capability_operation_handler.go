package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
)

// CapabilityOperationHandlers remain unregistered until the W8b consumer cutover.
type CapabilityOperationHandlers struct {
	operations *service.CapabilityOperationService
}

func NewCapabilityOperationHandlers(
	operations *service.CapabilityOperationService,
) *CapabilityOperationHandlers {
	return &CapabilityOperationHandlers{operations: operations}
}

func (h *CapabilityOperationHandlers) HandleStart(
	ctx context.Context,
	req *model.StartCapabilityOperationRequest,
) (*model.StartCapabilityOperationResponse, error) {
	operation, err := h.operations.Start(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.StartCapabilityOperationResponse{Operation: operation}, nil
}

func (h *CapabilityOperationHandlers) HandleCancel(
	ctx context.Context,
	req *model.CancelCapabilityOperationRequest,
) (*model.CancelCapabilityOperationResponse, error) {
	operation, err := h.operations.Cancel(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CancelCapabilityOperationResponse{Operation: operation}, nil
}

func (h *CapabilityOperationHandlers) HandleGet(
	ctx context.Context,
	req *model.GetCapabilityOperationRequest,
) (*model.GetCapabilityOperationResponse, error) {
	operation, err := h.operations.Get(
		ctx, subjectActorID(ctx), req.GetOperationId(),
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetCapabilityOperationResponse{Operation: operation}, nil
}

func (h *CapabilityOperationHandlers) HandleReportEvent(
	ctx context.Context,
	req *model.ReportCapabilityOperationEventRequest,
) (*model.ReportCapabilityOperationEventResponse, error) {
	operation, replayed, err := h.operations.ReportEventVerified(
		ctx,
		subjectActorID(ctx),
		serverwrapper.GetDeviceID(ctx),
		req,
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ReportCapabilityOperationEventResponse{
		Operation: operation,
		Replayed:  replayed,
	}, nil
}

func (h *CapabilityOperationHandlers) HandlePull(
	ctx context.Context,
	req *model.PullCapabilityOperationsRequest,
) (*model.PullCapabilityOperationsResponse, error) {
	response, err := h.operations.Pull(
		ctx,
		subjectActorID(ctx),
		serverwrapper.GetDeviceID(ctx),
		req,
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityOperationHandlers) HandleReconcile(
	ctx context.Context,
	req *model.ReconcileCapabilityOperationRequest,
) (*model.ReconcileCapabilityOperationResponse, error) {
	response, err := h.operations.Reconcile(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return response, nil
}

func (h *CapabilityOperationHandlers) HandleTakeOver(
	ctx context.Context,
	req *model.TakeOverCapabilityOperationRequest,
) (*model.TakeOverCapabilityOperationResponse, error) {
	operation, err := h.operations.TakeOverVerified(
		ctx,
		subjectActorID(ctx),
		serverwrapper.GetDeviceID(ctx),
		req,
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.TakeOverCapabilityOperationResponse{Operation: operation}, nil
}

func (h *CapabilityOperationHandlers) HandleTakeOverCleanup(
	ctx context.Context,
	req *model.TakeOverCapabilityCleanupRequest,
) (*model.TakeOverCapabilityCleanupResponse, error) {
	operation, err := h.operations.TakeOverCleanupVerified(
		ctx,
		subjectActorID(ctx),
		serverwrapper.GetDeviceID(ctx),
		req,
	)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.TakeOverCapabilityCleanupResponse{Operation: operation}, nil
}
