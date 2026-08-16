package httpinterface

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// ReceiptSubmitter defines the application-layer contract for receipt handling.
type ReceiptSubmitter interface {
	SubmitReceipt(
		ctx context.Context,
		sender *chat.CryptoEndpoint,
		request *chat.SubmitMessagingReceiptRequest,
	) (*chat.SubmitMessagingReceiptResponse, error)
	SubmitDeliveryReceipt(
		ctx context.Context,
		sender *chat.CryptoEndpoint,
		request *chat.SubmitConversationReceiptRequest,
	) (*chat.SubmitConversationReceiptResponse, error)
}

// ReceiptHandler handles HTTP receipt submissions (read cursors, device
// consumption acknowledgments).
type ReceiptHandler struct {
	service ReceiptSubmitter
}

func NewReceiptHandler(service ReceiptSubmitter) (*ReceiptHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: receipt handler requires service")
	}
	return &ReceiptHandler{service: service}, nil
}

// Submit validates the authenticated endpoint, then delegates to the receipt
// service for persistence and broadcast.
func (h *ReceiptHandler) Submit(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.SubmitMessagingReceiptRequest,
) (*chat.SubmitMessagingReceiptResponse, error) {
	if authenticatedPTID == "" || authenticatedDeviceID == "" {
		return nil, ErrEndpointBinding
	}
	if request == nil {
		return nil, ErrEndpointBinding
	}
	sender := &chat.CryptoEndpoint{
		Ptid:     authenticatedPTID,
		DeviceId: authenticatedDeviceID,
	}
	return h.service.SubmitReceipt(ctx, sender, request)
}

func (h *ReceiptHandler) SubmitDelivery(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.SubmitConversationReceiptRequest,
) (*chat.SubmitConversationReceiptResponse, error) {
	if authenticatedPTID == "" || authenticatedDeviceID == "" || request == nil {
		return nil, ErrEndpointBinding
	}
	sender := &chat.CryptoEndpoint{
		Ptid:     authenticatedPTID,
		DeviceId: authenticatedDeviceID,
	}
	return h.service.SubmitDeliveryReceipt(ctx, sender, request)
}

// Compile-time interface compliance.
var _ ReceiptSubmitter = (*application.ReceiptService)(nil)
