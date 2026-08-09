package httpinterface

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrEndpointBinding = errors.New("messaging: authenticated endpoint binding mismatch")

type QueueService interface {
	Claim(
		ctx context.Context,
		ptid string,
		request *chat.ClaimDeviceQueueRequest,
	) (*chat.ClaimDeviceQueueResponse, error)
	Acknowledge(
		ctx context.Context,
		ptid string,
		request *chat.AcknowledgeDeviceQueueItemRequest,
	) (*chat.AcknowledgeDeviceQueueItemResponse, error)
	Reject(
		ctx context.Context,
		ptid string,
		request *chat.RejectDeviceQueueItemRequest,
	) (*chat.RejectDeviceQueueItemResponse, error)
}

type QueueHandler struct {
	service QueueService
}

func NewQueueHandler(service QueueService) (*QueueHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: queue handler requires service")
	}
	return &QueueHandler{service: service}, nil
}

func (h *QueueHandler) Claim(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.ClaimDeviceQueueRequest,
) (*chat.ClaimDeviceQueueResponse, error) {
	if request == nil || !endpointMatches(
		authenticatedPTID,
		authenticatedDeviceID,
		request.DeviceId,
	) {
		return nil, ErrEndpointBinding
	}
	return h.service.Claim(ctx, authenticatedPTID, request)
}

func (h *QueueHandler) Acknowledge(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.AcknowledgeDeviceQueueItemRequest,
) (*chat.AcknowledgeDeviceQueueItemResponse, error) {
	if request == nil || !endpointMatches(
		authenticatedPTID,
		authenticatedDeviceID,
		request.DeviceId,
	) {
		return nil, ErrEndpointBinding
	}
	return h.service.Acknowledge(ctx, authenticatedPTID, request)
}

func (h *QueueHandler) Reject(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.RejectDeviceQueueItemRequest,
) (*chat.RejectDeviceQueueItemResponse, error) {
	if request == nil || !endpointMatches(
		authenticatedPTID,
		authenticatedDeviceID,
		request.DeviceId,
	) {
		return nil, ErrEndpointBinding
	}
	return h.service.Reject(ctx, authenticatedPTID, request)
}

func endpointMatches(ptid string, authenticatedDeviceID string, requestDeviceID string) bool {
	return ptid != "" &&
		authenticatedDeviceID != "" &&
		requestDeviceID != "" &&
		authenticatedDeviceID == requestDeviceID
}

var _ QueueService = (*application.QueueService)(nil)
