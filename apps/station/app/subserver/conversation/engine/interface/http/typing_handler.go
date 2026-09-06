package httpinterface

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// TypingBroadcaster defines the application-layer contract for typing relay.
type TypingBroadcaster interface {
	BroadcastTyping(
		ctx context.Context,
		sender *chat.CryptoEndpoint,
		conversationID string,
		isTyping bool,
	) error
}

// TypingHandler handles HTTP typing indicator submissions.
type TypingHandler struct {
	service TypingBroadcaster
}

func NewTypingHandler(service TypingBroadcaster) (*TypingHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: typing handler requires service")
	}
	return &TypingHandler{service: service}, nil
}

// SubmitTyping validates the authenticated endpoint matches the request, then
// broadcasts the typing indicator to other conversation members.
func (h *TypingHandler) SubmitTyping(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	conversationID string,
	isTyping bool,
) error {
	if authenticatedPTID == "" || authenticatedDeviceID == "" || conversationID == "" {
		return ErrEndpointBinding
	}
	sender := &chat.CryptoEndpoint{
		Ptid:     authenticatedPTID,
		DeviceId: authenticatedDeviceID,
	}
	return h.service.BroadcastTyping(ctx, sender, conversationID, isTyping)
}

// Compile-time interface compliance.
var _ TypingBroadcaster = (*application.TypingService)(nil)
