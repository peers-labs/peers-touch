package application

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
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
	localStationID string
	clock          func() time.Time
}

func NewReceiptService(
	unitOfWork messaging.AuthorityUnitOfWork,
	localStationID string,
	clock func() time.Time,
) (*ReceiptService, error) {
	if unitOfWork == nil {
		return nil, fmt.Errorf("messaging: receipt service requires unit of work")
	}
	if localStationID == "" {
		return nil, fmt.Errorf("messaging: receipt service requires local station ID")
	}
	if clock == nil {
		return nil, fmt.Errorf("messaging: receipt service requires clock")
	}
	return &ReceiptService{
		unitOfWork:     unitOfWork,
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
				IdempotencyKey: receiptQueueIdempotencyKey(
					"delivered",
					request.ConversationId,
					request.MessageId,
					sender.Ptid,
					sender.DeviceId,
					device.Endpoint.Ptid,
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
	cursorBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(cursor)
	if err != nil {
		return nil, fmt.Errorf("messaging: marshal read cursor: %w", err)
	}
	cursorHash := sha256.Sum256(cursorBytes)

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
			cursor.ConversationId,
		)
		if err != nil {
			return err
		}
		if !conversation.Active || cursor.LastReadSequence > conversation.CurrentSequence {
			return messaging.ErrConversationState
		}
		devices, err := repositories.Authority.ListActiveMemberDevices(
			ctx,
			cursor.ConversationId,
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
		if repositories.ReadCursors == nil {
			return fmt.Errorf("messaging: read cursor repository is unavailable")
		}
		if err := repositories.ReadCursors.UpsertReadCursor(ctx, cursor); err != nil {
			return err
		}

		for _, device := range devices {
			if !device.Active || device.Endpoint == nil {
				continue
			}
			if device.Endpoint.Ptid == sender.Ptid &&
				device.Endpoint.DeviceId == sender.DeviceId {
				continue
			}

			homeStation, err := repositories.EndpointManifests.HomeStationForEndpoint(
				ctx,
				device.Endpoint,
				now,
			)
			if err != nil {
				return err
			}
			if homeStation != s.localStationID {
				return fmt.Errorf(
					"messaging: read cursor target %s/%s is not local",
					device.Endpoint.Ptid,
					device.Endpoint.DeviceId,
				)
			}

			if _, err := repositories.Queue.Enqueue(ctx, &chat.DeviceQueueItem{
				Recipient: device.Endpoint,
				EventId: receiptTupleDigest(
					"read-event",
					cursor.ConversationId,
					cursor.ReaderPtid,
					fmt.Sprintf("%d", cursor.LastReadSequence),
				),
				ConversationId: cursor.ConversationId,
				IdempotencyKey: receiptQueueIdempotencyKey(
					"read",
					cursor.ConversationId,
					cursor.ReaderPtid,
					fmt.Sprintf("%d", cursor.LastReadSequence),
					device.Endpoint.Ptid,
					device.Endpoint.DeviceId,
				),
				PayloadType:   chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_DEVICE_RECEIPT,
				OpaquePayload: cursorBytes,
				PayloadSha256: cursorHash[:],
			}); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return &chat.SubmitMessagingReceiptResponse{}, nil
}

func receiptQueueIdempotencyKey(kind string, parts ...string) string {
	return kind + ":" + receiptTupleDigest(kind, parts...)
}

func receiptTupleDigest(kind string, parts ...string) string {
	hasher := sha256.New()
	for _, part := range append([]string{kind}, parts...) {
		var length [8]byte
		binary.BigEndian.PutUint64(length[:], uint64(len(part)))
		hasher.Write(length[:])
		hasher.Write([]byte(part))
	}
	return hex.EncodeToString(hasher.Sum(nil))
}
