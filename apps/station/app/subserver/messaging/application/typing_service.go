package application

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TypingService handles ephemeral typing indicator relay. Typing notifications
// are not persisted as conversation events; they are broadcast directly to other
// active local member devices via the device queue.
type TypingService struct {
	unitOfWork     messaging.AuthorityUnitOfWork
	localStationID string
	clock          func() time.Time
}

func NewTypingService(
	unitOfWork messaging.AuthorityUnitOfWork,
	localStationID string,
	clock func() time.Time,
) (*TypingService, error) {
	if unitOfWork == nil {
		return nil, fmt.Errorf("messaging: typing service requires unit of work")
	}
	if localStationID == "" {
		return nil, fmt.Errorf("messaging: typing service requires local station ID")
	}
	if clock == nil {
		return nil, fmt.Errorf("messaging: typing service requires clock")
	}
	return &TypingService{
		unitOfWork:     unitOfWork,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

// BroadcastTyping validates that the sender is an active member of the
// conversation, then relays the typing indicator to all other local member
// devices via their device queues. This is fire-and-forget; no event is
// persisted and no federation delivery is attempted for typing signals.
//
// The queue payload is a serialized ConversationCommand with a TypingCommand
// payload, allowing recipients to decode sender identity and typing state
// from existing proto types without requiring new message definitions.
func (s *TypingService) BroadcastTyping(
	ctx context.Context,
	sender *chat.CryptoEndpoint,
	conversationID string,
	isTyping bool,
) error {
	if sender == nil || sender.Ptid == "" || sender.DeviceId == "" {
		return fmt.Errorf("messaging: typing sender endpoint is required")
	}
	if conversationID == "" {
		return fmt.Errorf("messaging: typing conversation_id is required")
	}

	now := s.clock().UTC()

	// Build a ConversationCommand carrying the TypingCommand as the opaque
	// queue payload. This reuses existing proto definitions so clients can
	// decode the payload without additional message types.
	typingCommand := &chat.ConversationCommand{
		CommandId:      uuid.New().String(),
		ConversationId: conversationID,
		SenderPtid:     sender.Ptid,
		SenderDeviceId: sender.DeviceId,
		ClientTs:       timestamppb.New(now),
		Payload: &chat.ConversationCommand_Typing{
			Typing: &chat.TypingCommand{IsTyping: isTyping},
		},
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(typingCommand)
	if err != nil {
		return fmt.Errorf("messaging: marshal typing command: %w", err)
	}
	payloadHash := sha256.Sum256(payloadBytes)

	return s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		// Validate sender is an active device in this conversation.
		active, err := repositories.Devices.IsActive(ctx, sender)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}

		// Verify the conversation exists and is active.
		conversation, err := repositories.Authority.LockConversation(ctx, conversationID)
		if err != nil {
			return err
		}
		if !conversation.Active {
			return messaging.ErrConversationState
		}

		// List all active member devices to deliver the typing indicator.
		devices, err := repositories.Authority.ListActiveMemberDevices(ctx, conversationID)
		if err != nil {
			return err
		}

		// Enqueue to all local member devices except the sender.
		idempotencyKey := "typing:" + typingCommand.CommandId
		for _, device := range devices {
			if !device.Active || device.Endpoint == nil {
				continue
			}
			if device.Endpoint.Ptid == sender.Ptid &&
				device.Endpoint.DeviceId == sender.DeviceId {
				continue
			}

			// Only enqueue for local devices; typing is ephemeral and not federated.
			homeStation, err := repositories.EndpointManifests.HomeStationForEndpoint(
				ctx,
				device.Endpoint,
				now,
			)
			if err != nil {
				slog.WarnContext(ctx,
					"messaging: skip typing delivery for unreachable endpoint",
					"conversation_id", conversationID,
					"recipient_ptid", device.Endpoint.Ptid,
					"recipient_device_id", device.Endpoint.DeviceId,
				)
				continue
			}
			if homeStation != s.localStationID {
				continue
			}

			if _, err := repositories.Queue.Enqueue(ctx, &chat.DeviceQueueItem{
				Recipient:      device.Endpoint,
				ConversationId: conversationID,
				IdempotencyKey: idempotencyKey + ":" + device.Endpoint.Ptid + ":" + device.Endpoint.DeviceId,
				PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_DEVICE_RECEIPT,
				OpaquePayload:  payloadBytes,
				PayloadSha256:  payloadHash[:],
			}); err != nil {
				slog.WarnContext(ctx,
					"messaging: typing enqueue failed for device",
					"conversation_id", conversationID,
					"recipient_ptid", device.Endpoint.Ptid,
					"recipient_device_id", device.Endpoint.DeviceId,
					"error", err,
				)
			}
		}

		return nil
	})
}
