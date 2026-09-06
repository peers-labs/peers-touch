package httpinterface

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type AuthorityService interface {
	PrepareSend(
		ctx context.Context,
		request *chat.PrepareMessagingSendRequest,
	) (*chat.PrepareMessagingSendResponse, error)
	Submit(
		ctx context.Context,
		command *chat.ChatCommand,
	) (*chat.ConversationEvent, error)
}

type CommandHandler struct {
	service AuthorityService
}

func NewCommandHandler(service AuthorityService) (*CommandHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: command handler requires service")
	}
	return &CommandHandler{service: service}, nil
}

func (h *CommandHandler) PrepareSend(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	if request == nil ||
		request.Sender == nil ||
		authenticatedPTID == "" ||
		authenticatedDeviceID == "" ||
		request.Sender.Ptid != authenticatedPTID ||
		request.Sender.DeviceId != authenticatedDeviceID {
		return nil, ErrEndpointBinding
	}
	return h.service.PrepareSend(ctx, request)
}

func (h *CommandHandler) Submit(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.SubmitMessagingCommandRequest,
) (*chat.SubmitMessagingCommandResponse, error) {
	if request == nil {
		return nil, ErrEndpointBinding
	}
	command := request.Command
	if command == nil ||
		command.Sender == nil ||
		authenticatedPTID == "" ||
		authenticatedDeviceID == "" ||
		command.Sender.Ptid != authenticatedPTID ||
		command.Sender.DeviceId != authenticatedDeviceID {
		return nil, ErrEndpointBinding
	}
	event, err := h.service.Submit(ctx, command)
	if err == nil {
		return &chat.SubmitMessagingCommandResponse{Event: event}, nil
	}
	rejectCode := commandRejectCode(err)
	if rejectCode == chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_UNSPECIFIED {
		return nil, err
	}
	response := &chat.SubmitMessagingCommandResponse{RejectCode: rejectCode}
	if errors.Is(err, domain.ErrStaleDeliveryPlan) {
		currentPlan, prepareErr := h.service.PrepareSend(
			ctx,
			&chat.PrepareMessagingSendRequest{
				ConversationId:     command.ConversationId,
				Sender:             command.Sender,
				AuthorityStationId: command.AuthorityStationId,
			},
		)
		if prepareErr != nil {
			return nil, prepareErr
		}
		response.CurrentSendPlan = currentPlan
	}
	return response, nil
}

func commandRejectCode(err error) chat.MessagingCommandRejectCode {
	switch {
	case errors.Is(err, domain.ErrStaleDeliveryPlan):
		return chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_STALE_DELIVERY_PLAN
	case errors.Is(err, domain.ErrConversationState):
		return chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_CONVERSATION_STATE
	case errors.Is(err, domain.ErrSenderUnauthorized):
		return chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_SENDER_UNAUTHORIZED
	case errors.Is(err, domain.ErrDeliverySet):
		return chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_DELIVERY_SET
	case errors.Is(err, domain.ErrUnsupportedCommand):
		return chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_UNSUPPORTED_COMMAND
	default:
		return chat.MessagingCommandRejectCode_MESSAGING_COMMAND_REJECT_CODE_UNSPECIFIED
	}
}

var _ AuthorityService = (*application.AuthorityService)(nil)
