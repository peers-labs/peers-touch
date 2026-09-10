package http

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type InteractionApplication interface {
	SubmitTyping(
		ctx context.Context,
		pulse interaction.TypingPulse,
	) (interaction.TypingResult, error)
	SubmitReadCursor(
		ctx context.Context,
		request interaction.ReadCursorRequest,
	) (interaction.ReadCursorResult, error)
	SubmitDeliveryReceipt(
		ctx context.Context,
		receipt interaction.DeliveryReceipt,
	) (interaction.DeliveryRecordResult, error)
}

// InteractionHandler maps canonical protobuf contracts without registering production routes.
type InteractionHandler struct {
	service InteractionApplication
}

func NewInteractionHandler(service InteractionApplication) (*InteractionHandler, error) {
	if service == nil {
		return nil, interaction.NewError(
			interaction.ErrorCodeInvalidArgument,
			"interaction_handler.new",
			"service",
			"is required",
		)
	}

	return &InteractionHandler{service: service}, nil
}

func (h *InteractionHandler) SubmitTyping(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.SubmitConversationTypingRequest,
) (*chat.SubmitConversationTypingResponse, error) {
	if request == nil || request.GetSender() == nil ||
		request.GetExpiresAt() == nil || !request.GetExpiresAt().IsValid() {
		return nil, invalidInteractionRequest("interaction_handler.submit_typing")
	}
	sender, err := bindAuthenticatedDevice(
		authenticated,
		request.GetSender(),
		"interaction_handler.submit_typing",
	)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, err
	}
	result, err := h.service.SubmitTyping(ctx, interaction.TypingPulse{
		ConversationID: conversationID,
		Sender:         sender,
		Generation:     request.GetPulseGeneration(),
		ExpiresAt:      request.GetExpiresAt().AsTime(),
		IsTyping:       request.GetIsTyping(),
	})
	if err != nil {
		return nil, err
	}

	return &chat.SubmitConversationTypingResponse{
		Accepted:  result.Accepted,
		ExpiresAt: timestamppb.New(result.ExpiresAt.UTC()),
	}, nil
}

func (h *InteractionHandler) SubmitReadCursor(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.SubmitConversationReadCursorRequest,
) (*chat.SubmitConversationReadCursorResponse, error) {
	if request == nil || request.GetCursor() == nil {
		return nil, invalidInteractionRequest("interaction_handler.submit_read_cursor")
	}
	reader, err := valueobject.NewEndpoint(authenticated.PTID, authenticated.DeviceID)
	if err != nil || request.GetCursor().GetReaderPtid() != authenticated.PTID {
		return nil, interaction.NewError(
			interaction.ErrorCodeUnauthorized,
			"interaction_handler.submit_read_cursor",
			"reader",
			"does not match the authenticated endpoint",
		)
	}
	conversationID, err := valueobject.NewConversationID(
		request.GetCursor().GetConversationId(),
	)
	if err != nil {
		return nil, err
	}
	result, err := h.service.SubmitReadCursor(
		ctx,
		interaction.ReadCursorRequest{
			ConversationID: conversationID,
			Reader:         reader,
			Sequence:       valueobject.Sequence(request.GetCursor().GetLastReadSequence()),
		},
	)
	if err != nil {
		return nil, err
	}
	if result.Result.PostCommitError != nil {
		return nil, interaction.WrapError(
			interaction.ErrorCodePersistence,
			"interaction_handler.submit_read_cursor.notify",
			result.Result.PostCommitError,
		)
	}

	return &chat.SubmitConversationReadCursorResponse{
		Cursor: &chat.ActorReadCursor{
			ConversationId:   string(result.Result.Cursor.ConversationID),
			ReaderPtid:       string(result.Result.Cursor.Actor),
			LastReadSequence: int64(result.Result.Cursor.Sequence),
			UpdatedAt:        timestamppb.New(result.Result.Cursor.UpdatedAt.UTC()),
		},
	}, nil
}

func (h *InteractionHandler) SubmitDeliveryReceipt(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.SubmitConversationDeliveryReceiptRequest,
) (*chat.SubmitConversationDeliveryReceiptResponse, error) {
	if request == nil || request.GetReceipt() == nil ||
		request.GetReceipt().GetConsumer() == nil ||
		request.GetReceipt().GetConsumedAt() == nil ||
		!request.GetReceipt().GetConsumedAt().IsValid() {
		return nil, invalidInteractionRequest(
			"interaction_handler.submit_delivery_receipt",
		)
	}
	consumer, err := bindInteractionEndpoint(
		authenticated,
		request.GetReceipt().GetConsumer(),
		"interaction_handler.submit_delivery_receipt",
	)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(
		request.GetReceipt().GetConversationId(),
	)
	if err != nil {
		return nil, err
	}
	eventID, err := valueobject.NewEventID(request.GetReceipt().GetEventId())
	if err != nil {
		return nil, err
	}
	payloadHash, err := valueobject.NewHash(request.GetReceipt().GetPayloadSha256())
	if err != nil {
		return nil, invalidInteractionRequest(
			"interaction_handler.submit_delivery_receipt",
		)
	}
	result, err := h.service.SubmitDeliveryReceipt(
		ctx,
		interaction.DeliveryReceipt{
			ReceiptID:      request.GetReceipt().GetReceiptId(),
			ConversationID: conversationID,
			EventID:        eventID,
			Consumer:       consumer,
			EventSequence:  valueobject.Sequence(request.GetReceipt().GetEventSequence()),
			LaneSequence:   request.GetReceipt().GetLaneSequence(),
			PayloadHash:    payloadHash,
			ConsumedAt:     request.GetReceipt().GetConsumedAt().AsTime(),
		},
	)
	if err != nil {
		return nil, err
	}

	if result.Forwarded {
		return &chat.SubmitConversationDeliveryReceiptResponse{}, nil
	}

	return &chat.SubmitConversationDeliveryReceiptResponse{
		Delivery: &chat.MessageDeliveryAggregate{
			ConversationId:      string(result.Aggregate.ConversationID),
			EventId:             string(result.Aggregate.EventID),
			EventSequence:       int64(result.Aggregate.EventSequence),
			RequiredDeviceCount: result.Aggregate.RequiredDeviceCount,
			ConsumedDeviceCount: result.Aggregate.ConsumedDeviceCount,
			RevokedDeviceCount:  result.Aggregate.RevokedDeviceCount,
			Delivered:           result.Aggregate.Delivered,
			FullyDelivered:      result.Aggregate.FullyDelivered,
			Read:                result.Aggregate.Read,
		},
	}, nil
}

func invalidInteractionRequest(operation string) error {
	return interaction.NewError(
		interaction.ErrorCodeInvalidArgument,
		operation,
		"request",
		"is incomplete or malformed",
	)
}

func bindInteractionEndpoint(
	authenticated AuthenticatedActor,
	request *chat.CryptoEndpoint,
	operation string,
) (valueobject.Endpoint, error) {
	if request == nil ||
		request.GetPtid() != authenticated.PTID ||
		request.GetDeviceId() != authenticated.DeviceID {
		return valueobject.Endpoint{}, interaction.NewError(
			interaction.ErrorCodeUnauthorized,
			operation,
			"consumer",
			"does not match the authenticated endpoint",
		)
	}
	endpoint, err := valueobject.NewEndpoint(authenticated.PTID, authenticated.DeviceID)
	if err != nil {
		return valueobject.Endpoint{}, interaction.NewError(
			interaction.ErrorCodeUnauthorized,
			operation,
			"consumer",
			"is not a complete authenticated endpoint",
		)
	}

	return endpoint, nil
}

var _ InteractionApplication = (*interaction.Service)(nil)
