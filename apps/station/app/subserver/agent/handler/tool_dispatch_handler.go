package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func (h *TurnHandlers) HandleRegisterClientCapabilityLease(
	ctx context.Context,
	request *model.RegisterClientCapabilityLeaseRequest,
) (*model.RegisterClientCapabilityLeaseResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID := serverwrapper.GetDeviceID(ctx)
	if deviceID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "X-Device-ID is required")
	}
	response, err := h.turnService.RegisterClientCapabilityLease(
		ctx,
		subject.ID,
		subject.SessionID,
		deviceID,
		request,
	)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func (h *TurnHandlers) HandleRenewClientCapabilityLease(
	ctx context.Context,
	request *model.RenewClientCapabilityLeaseRequest,
) (*model.RenewClientCapabilityLeaseResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID := serverwrapper.GetDeviceID(ctx)
	if deviceID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "X-Device-ID is required")
	}
	response, err := h.turnService.RenewClientCapabilityLease(
		ctx,
		subject.ID,
		subject.SessionID,
		deviceID,
		request,
	)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func (h *TurnHandlers) HandleRevokeClientCapabilityLease(
	ctx context.Context,
	request *model.RevokeClientCapabilityLeaseRequest,
) (*model.RevokeClientCapabilityLeaseResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID := serverwrapper.GetDeviceID(ctx)
	if deviceID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "X-Device-ID is required")
	}
	response, err := h.turnService.RevokeClientCapabilityLease(
		ctx,
		subject.ID,
		subject.SessionID,
		deviceID,
		request,
	)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func (h *TurnHandlers) HandleSubmitToolDecision(
	ctx context.Context,
	request *model.SubmitToolApprovalDecisionRequest,
) (*model.SubmitToolApprovalDecisionResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	response, err := h.turnService.SubmitToolDecision(ctx, subject.ID, request)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func (h *TurnHandlers) HandlePullClientCapabilityRequests(
	ctx context.Context,
	request *model.PullClientCapabilityRequestsRequest,
) (*model.PullClientCapabilityRequestsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID := serverwrapper.GetDeviceID(ctx)
	if deviceID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "X-Device-ID is required")
	}
	response, err := h.turnService.PullClientCapabilityRequests(ctx, subject.ID, deviceID, request)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func (h *TurnHandlers) HandleSubmitClientCapabilityReceipt(
	ctx context.Context,
	request *model.SubmitClientCapabilityReceiptRequest,
) (*model.SubmitClientCapabilityReceiptResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	deviceID := serverwrapper.GetDeviceID(ctx)
	if deviceID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "X-Device-ID is required")
	}
	response, err := h.turnService.SubmitClientCapabilityReceipt(ctx, subject.ID, deviceID, request)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func (h *TurnHandlers) HandleSubmitClientCapabilityRecoveryReceipt(
	ctx context.Context,
	request *model.SubmitClientCapabilityRecoveryReceiptRequest,
) (*model.SubmitClientCapabilityRecoveryReceiptResponse, error) {
	response, err := h.turnService.SubmitClientCapabilityRecoveryReceipt(ctx, request)
	if err != nil {
		return nil, toolHandlerError(err)
	}
	return response, nil
}

func toolHandlerError(err error) error {
	var businessError *errcode.BizError
	if errors.As(err, &businessError) {
		return server.NewHandlerError(businessError.HTTPStatus, businessError.Message)
	}
	return server.InternalErrorWithCause("tool authority operation failed", err)
}
