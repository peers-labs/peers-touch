package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type FederationPolicy struct {
	MaxBatchWrites int
}

type FederationService struct {
	unitOfWork messaging.FederationInboxUnitOfWork
	devices    DeviceAccess
	policy     FederationPolicy
}

func NewFederationService(
	unitOfWork messaging.FederationInboxUnitOfWork,
	devices DeviceAccess,
	policy FederationPolicy,
) (*FederationService, error) {
	if unitOfWork == nil || devices == nil || policy.MaxBatchWrites <= 0 {
		return nil, fmt.Errorf("messaging: federation service dependencies are invalid")
	}
	return &FederationService{
		unitOfWork: unitOfWork,
		devices:    devices,
		policy:     policy,
	}, nil
}

func (s *FederationService) Deliver(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	expectedTargetStationID string,
	sourceStationPublicKey ed25519.PublicKey,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	if err := VerifyFederationFrame(
		frame,
		expectedTargetStationID,
		sourceStationPublicKey,
		now,
	); err != nil {
		return nil, err
	}
	if frame.PayloadType != chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH ||
		frame.EventId == "" ||
		frame.ConversationId == "" {
		return nil, messaging.ErrFederationFrameInvalid
	}
	batch := &chat.FederatedDeviceQueueBatch{}
	if err := proto.Unmarshal(frame.OpaquePayload, batch); err != nil {
		return nil, messaging.ErrFederationFrameInvalid
	}
	if len(batch.Writes) == 0 || len(batch.Writes) > s.policy.MaxBatchWrites {
		return nil, messaging.ErrFederationFrameInvalid
	}
	seen := make(map[string]struct{}, len(batch.Writes))
	for _, write := range batch.Writes {
		if write == nil ||
			write.Recipient == nil ||
			write.Recipient.Ptid == "" ||
			write.Recipient.DeviceId == "" ||
			write.EventId != frame.EventId ||
			write.ConversationId != frame.ConversationId ||
			write.IdempotencyKey == "" ||
			write.PayloadType == chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_UNSPECIFIED ||
			len(write.OpaquePayload) == 0 ||
			len(write.PayloadSha256) != sha256.Size {
			return nil, messaging.ErrFederationFrameInvalid
		}
		hash := sha256.Sum256(write.OpaquePayload)
		if !bytes.Equal(hash[:], write.PayloadSha256) {
			return nil, messaging.ErrFederationFrameInvalid
		}
		key := write.Recipient.Ptid + "\x00" + write.Recipient.DeviceId
		if _, duplicate := seen[key]; duplicate {
			return nil, messaging.ErrFederationFrameInvalid
		}
		seen[key] = struct{}{}
	}

	duplicate, err := s.unitOfWork.IngestFederationFrame(
		ctx,
		frame,
		now.UTC(),
		func(queue messaging.QueueRepository) error {
			for _, write := range batch.Writes {
				active, err := s.devices.IsActiveDevice(
					ctx,
					write.Recipient.Ptid,
					write.Recipient.DeviceId,
				)
				if err != nil {
					return err
				}
				if !active {
					continue
				}
				if _, err := queue.Enqueue(ctx, &chat.DeviceQueueItem{
					Recipient:      write.Recipient,
					EventId:        write.EventId,
					ConversationId: write.ConversationId,
					IdempotencyKey: write.IdempotencyKey,
					PayloadType:    write.PayloadType,
					OpaquePayload:  write.OpaquePayload,
					PayloadSha256:  write.PayloadSha256,
				}); err != nil {
					return err
				}
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	return &chat.DeliverMessagingFederationFrameResponse{
		Accepted:  true,
		Duplicate: duplicate,
	}, nil
}
