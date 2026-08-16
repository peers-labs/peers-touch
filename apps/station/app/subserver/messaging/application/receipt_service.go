package application

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ReceiptService handles read receipt submission, persistence, and broadcast.
// Read cursors are persisted per (conversation_id, actor_ptid) and broadcast
// to other conversation members via their device queues.
type ReceiptService struct {
	unitOfWork     messaging.AuthorityUnitOfWork
	readCursors    messaging.ReadCursorRepository
	localStationID string
	clock          func() time.Time
}

func NewReceiptService(
	unitOfWork messaging.AuthorityUnitOfWork,
	readCursors messaging.ReadCursorRepository,
	localStationID string,
	clock func() time.Time,
) (*ReceiptService, error) {
	if unitOfWork == nil {
		return nil, fmt.Errorf("messaging: receipt service requires unit of work")
	}
	if readCursors == nil {
		return nil, fmt.Errorf("messaging: receipt service requires read cursor repository")
	}
	if localStationID == "" {
		return nil, fmt.Errorf("messaging: receipt service requires local station ID")
	}
	if clock == nil {
		return nil, fmt.Errorf("messaging: receipt service requires clock")
	}
	return &ReceiptService{
		unitOfWork:     unitOfWork,
		readCursors:    readCursors,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

// SubmitReceipt processes a messaging receipt submission. For ACTOR_READ kind,
// it persists the read cursor and broadcasts the update to other conversation
// members.
func (s *ReceiptService) SubmitReceipt(
	ctx context.Context,
	sender *chat.CryptoEndpoint,
	request *chat.SubmitMessagingReceiptRequest,
) (*chat.SubmitMessagingReceiptResponse, error) {
	if sender == nil || sender.Ptid == "" || sender.DeviceId == "" {
		return nil, fmt.Errorf("messaging: receipt sender endpoint is required")
	}
	if request == nil {
		return nil, fmt.Errorf("messaging: receipt request is required")
	}

	switch request.Kind {
	case chat.MessagingReceiptKind_MESSAGING_RECEIPT_KIND_ACTOR_READ:
		return s.handleActorRead(ctx, sender, request.GetActorRead())
	default:
		return nil, messaging.ErrUnsupportedCommand
	}
}

// SubmitDeliveryReceipt routes a typed DELIVERED receipt through the canonical
// per-device messaging queue to every active device of the other Direct member.
func (s *ReceiptService) SubmitDeliveryReceipt(
	ctx context.Context,
	sender *chat.CryptoEndpoint,
	request *chat.SubmitConversationReceiptRequest,
) (*chat.SubmitConversationReceiptResponse, error) {
	if sender == nil || sender.Ptid == "" || sender.DeviceId == "" {
		return nil, fmt.Errorf("messaging: delivery receipt sender endpoint is required")
	}
	if request == nil ||
		request.ConversationId == "" ||
		request.MessageId == "" ||
		request.DeviceId != sender.DeviceId ||
		request.ReceiptType != chat.ReceiptType_RECEIPT_TYPE_DELIVERED {
		return nil, fmt.Errorf("messaging: valid DELIVERED receipt fields are required")
	}

	now := s.clock().UTC()
	receipt := &chat.MessageReceipt{
		ConversationId: request.ConversationId,
		MessageId:      request.MessageId,
		Ptid:           sender.Ptid,
		DeviceId:       sender.DeviceId,
		ReceiptType:    request.ReceiptType,
		Ts:             timestamppb.New(now),
	}
	receiptBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(receipt)
	if err != nil {
		return nil, fmt.Errorf("messaging: marshal delivery receipt: %w", err)
	}
	receiptHash := sha256.Sum256(receiptBytes)

	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		active, err := repositories.Devices.IsActive(ctx, sender)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		conversation, err := repositories.Authority.LockConversation(
			ctx,
			request.ConversationId,
		)
		if err != nil {
			return err
		}
		if !conversation.Active ||
			conversation.Kind != messaging.AuthorityConversationKindDirect {
			return messaging.ErrConversationState
		}
		devices, err := repositories.Authority.ListActiveMemberDevices(
			ctx,
			request.ConversationId,
		)
		if err != nil {
			return err
		}
		senderIsMember := false
		for _, device := range devices {
			if device.Active && device.Endpoint != nil &&
				device.Endpoint.Ptid == sender.Ptid &&
				device.Endpoint.DeviceId == sender.DeviceId {
				senderIsMember = true
				break
			}
		}
		if !senderIsMember {
			return messaging.ErrSenderUnauthorized
		}
		for _, device := range devices {
			if !device.Active || device.Endpoint == nil || device.Endpoint.Ptid == sender.Ptid {
				continue
			}
			homeStation, err := repositories.EndpointManifests.HomeStationForEndpoint(
				ctx,
				device.Endpoint,
				now,
			)
			if err != nil {
				return fmt.Errorf("messaging: resolve delivery receipt target: %w", err)
			}
			if homeStation != s.localStationID {
				return fmt.Errorf(
					"messaging: delivery receipt target %s/%s is not local",
					device.Endpoint.Ptid,
					device.Endpoint.DeviceId,
				)
			}
			if _, err := repositories.Queue.Enqueue(ctx, &chat.DeviceQueueItem{
				Recipient:      device.Endpoint,
				EventId:        request.MessageId,
				ConversationId: request.ConversationId,
				IdempotencyKey: fmt.Sprintf(
					"delivered:%s:%s:%s:%s:%s",
					request.ConversationId,
					request.MessageId,
					sender.Ptid,
					sender.DeviceId,
					device.Endpoint.DeviceId,
				),
				PayloadType:   chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_DEVICE_RECEIPT,
				OpaquePayload: receiptBytes,
				PayloadSha256: receiptHash[:],
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &chat.SubmitConversationReceiptResponse{}, nil
}

// handleActorRead persists the read cursor and broadcasts to other members.
func (s *ReceiptService) handleActorRead(
	ctx context.Context,
	sender *chat.CryptoEndpoint,
	cursor *chat.ActorReadCursor,
) (*chat.SubmitMessagingReceiptResponse, error) {
	if cursor == nil ||
		cursor.ConversationId == "" ||
		cursor.ReaderPtid == "" ||
		cursor.LastReadSequence <= 0 {
		return nil, fmt.Errorf("messaging: actor read cursor fields are required")
	}
	// The reader must be the authenticated actor.
	if cursor.ReaderPtid != sender.Ptid {
		return nil, messaging.ErrSenderUnauthorized
	}

	now := s.clock().UTC()
	cursor.UpdatedAt = timestamppb.New(now)

	// Persist the read cursor (upsert — only advance, never regress).
	if err := s.readCursors.UpsertReadCursor(ctx, cursor); err != nil {
		return nil, err
	}

	// Broadcast the read cursor update to other conversation members via queue.
	s.broadcastReadCursor(ctx, sender, cursor, now)

	return &chat.SubmitMessagingReceiptResponse{}, nil
}

// broadcastReadCursor enqueues the read cursor update to other local member
// devices. This is best-effort; enqueue failures are logged but do not fail
// the receipt submission.
func (s *ReceiptService) broadcastReadCursor(
	ctx context.Context,
	sender *chat.CryptoEndpoint,
	cursor *chat.ActorReadCursor,
	now time.Time,
) {
	cursorBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(cursor)
	if err != nil {
		slog.ErrorContext(ctx,
			"messaging: marshal read cursor for broadcast failed",
			"conversation_id", cursor.ConversationId,
			"reader_ptid", cursor.ReaderPtid,
			"error", err,
		)
		return
	}
	cursorHash := sha256.Sum256(cursorBytes)

	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		// Validate sender is still active.
		active, err := repositories.Devices.IsActive(ctx, sender)
		if err != nil || !active {
			return nil
		}

		// List active member devices for broadcast.
		devices, err := repositories.Authority.ListActiveMemberDevices(
			ctx,
			cursor.ConversationId,
		)
		if err != nil {
			return err
		}

		idempotencyKey := fmt.Sprintf(
			"read:%s:%s:%d",
			cursor.ConversationId,
			cursor.ReaderPtid,
			cursor.LastReadSequence,
		)

		for _, device := range devices {
			if !device.Active || device.Endpoint == nil {
				continue
			}
			// Skip sender's own devices.
			if device.Endpoint.Ptid == sender.Ptid {
				continue
			}

			homeStation, err := repositories.EndpointManifests.HomeStationForEndpoint(
				ctx,
				device.Endpoint,
				now,
			)
			if err != nil {
				continue
			}
			if homeStation != s.localStationID {
				continue
			}

			if _, err := repositories.Queue.Enqueue(ctx, &chat.DeviceQueueItem{
				Recipient:      device.Endpoint,
				ConversationId: cursor.ConversationId,
				IdempotencyKey: idempotencyKey + ":" + device.Endpoint.Ptid + ":" + device.Endpoint.DeviceId,
				PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_DEVICE_RECEIPT,
				OpaquePayload:  cursorBytes,
				PayloadSha256:  cursorHash[:],
			}); err != nil {
				slog.WarnContext(ctx,
					"messaging: read cursor enqueue failed for device",
					"conversation_id", cursor.ConversationId,
					"recipient_ptid", device.Endpoint.Ptid,
					"recipient_device_id", device.Endpoint.DeviceId,
					"error", err,
				)
			}
		}

		return nil
	})
	if err != nil {
		slog.WarnContext(ctx,
			"messaging: read cursor broadcast failed",
			"conversation_id", cursor.ConversationId,
			"reader_ptid", cursor.ReaderPtid,
			"error", err,
		)
	}
}
