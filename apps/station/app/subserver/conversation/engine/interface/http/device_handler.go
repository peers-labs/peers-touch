package httpinterface

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type DeviceService interface {
	Enroll(
		ctx context.Context,
		authenticatedPTID string,
		authenticatedDeviceID string,
		request *chat.EnrollMessagingDeviceRequest,
	) (*chat.EnrollMessagingDeviceResponse, error)
}

type DeviceHandler struct {
	service DeviceService
}

func NewDeviceHandler(service DeviceService) (*DeviceHandler, error) {
	if service == nil {
		return nil, fmt.Errorf("messaging: device handler requires service")
	}
	return &DeviceHandler{service: service}, nil
}

func (h *DeviceHandler) Enroll(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.EnrollMessagingDeviceRequest,
) (*chat.EnrollMessagingDeviceResponse, error) {
	if request == nil ||
		request.Certificate == nil ||
		request.Certificate.Ptid != authenticatedPTID ||
		request.Certificate.DeviceId != authenticatedDeviceID {
		return nil, ErrEndpointBinding
	}
	return h.service.Enroll(ctx, authenticatedPTID, authenticatedDeviceID, request)
}

var _ DeviceService = (*application.DeviceService)(nil)
