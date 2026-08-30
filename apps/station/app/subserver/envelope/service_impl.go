package envelope

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// DefaultService implements Service with durable outbox/inbox semantics.
type DefaultService struct {
	repo                Repository
	bus                 DeviceBus
	federatedApplier    FederatedDeliveryApplier
	localStationIDFunc  func() string
	maxDeliveryAttempts int
}

// NewService creates the envelope application service.
func NewService(
	repo Repository,
	bus DeviceBus,
	localStationIDFunc func() string,
	appliers ...FederatedDeliveryApplier,
) *DefaultService {
	service := &DefaultService{
		repo:                repo,
		bus:                 bus,
		localStationIDFunc:  localStationIDFunc,
		maxDeliveryAttempts: 20,
	}
	if len(appliers) > 0 {
		service.federatedApplier = appliers[0]
	}
	return service
}

func (s *DefaultService) Submit(ctx context.Context, env *chat.StationEnvelope) (string, error) {
	if err := validateEnvelopeAddressing(env); err != nil {
		return "", err
	}
	if env.EnvelopeId == "" {
		env.EnvelopeId = uuid.NewString()
	}
	if env.IdempotencyKey == "" {
		return "", fmt.Errorf("envelope: idempotency_key is required")
	}

	exists, err := s.repo.HasIdempotencyKey(ctx, env.IdempotencyKey)
	if err != nil {
		return "", fmt.Errorf("envelope: idempotency check failed: %w", err)
	}
	if exists {
		return env.EnvelopeId, nil
	}

	if s.isLocalRecipient(env) {
		return s.deliverLocal(ctx, env)
	}
	return s.enqueueForFederation(ctx, env)
}

func (s *DefaultService) Deliver(ctx context.Context, env *chat.StationEnvelope, claims *FederationClaims) error {
	if err := validateEnvelopeAddressing(env); err != nil {
		return err
	}
	if err := s.validateFederationClaims(env, claims); err != nil {
		return fmt.Errorf("envelope: federation validation failed: %w", err)
	}
	if s.federatedApplier != nil {
		handled, notifications, err := s.federatedApplier.ApplyFederatedDelivery(
			ctx,
			env,
			claims.IssuerStationPeerID,
		)
		if err != nil {
			return err
		}
		if handled {
			for _, item := range notifications {
				s.NotifyPersisted(ctx, item)
			}
			return nil
		}
	}

	exists, err := s.repo.HasIdempotencyKey(ctx, env.IdempotencyKey)
	if err != nil {
		return fmt.Errorf("envelope: idempotency check failed: %w", err)
	}
	if exists {
		return nil
	}

	_, err = s.deliverLocal(ctx, env)
	return err
}

func (s *DefaultService) Ack(ctx context.Context, recipientPTID, deviceID, inboxItemID string) error {
	return s.repo.MarkInboxAcked(ctx, inboxItemID)
}

func (s *DefaultService) Resume(ctx context.Context, recipientPTID, deviceID string, afterCursor string) ([]*chat.DeviceInboxItem, error) {
	return s.repo.UnackedInboxItems(ctx, recipientPTID, deviceID, afterCursor, 500)
}

func (s *DefaultService) isLocalRecipient(env *chat.StationEnvelope) bool {
	return env.RecipientHomeStationPeerId == "" || env.RecipientHomeStationPeerId == s.localStationIDFunc()
}

func (s *DefaultService) deliverLocal(ctx context.Context, env *chat.StationEnvelope) (string, error) {
	item := &chat.DeviceInboxItem{
		InboxItemId:       uuid.NewString(),
		RecipientPtid:     env.RecipientPtid,
		RecipientDeviceId: env.RecipientDeviceId,
		Envelope:          env,
		Status:            chat.InboxItemStatus_INBOX_ITEM_STATUS_PENDING,
		DeliveryAttempts:  0,
	}

	inboxID, err := s.repo.EnqueueInbox(ctx, item)
	if err != nil {
		return "", fmt.Errorf("envelope: enqueue inbox failed: %w", err)
	}

	item.InboxItemId = inboxID
	s.NotifyPersisted(ctx, item)
	return env.EnvelopeId, nil
}

func (s *DefaultService) NotifyPersisted(ctx context.Context, item *chat.DeviceInboxItem) {
	if item == nil || item.Envelope == nil {
		return
	}
	env := item.Envelope
	if env.PayloadType == chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE &&
		env.RecipientDeviceId == "" {
		return
	}
	inboxID := item.InboxItemId
	if env.RecipientDeviceId != "" {
		delivered := s.bus.PublishToDevice(ctx, env.RecipientPtid, env.RecipientDeviceId, inboxID, env)
		if delivered {
			_ = s.repo.MarkInboxDelivered(ctx, inboxID, time.Now())
		}
	} else {
		count := s.bus.PublishToActor(ctx, env.RecipientPtid, inboxID, env)
		if count > 0 {
			_ = s.repo.MarkInboxDelivered(ctx, inboxID, time.Now())
		}
	}
}

func validateEnvelopeAddressing(env *chat.StationEnvelope) error {
	if env == nil {
		return fmt.Errorf("envelope: envelope is required")
	}
	if env.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_DIRECT_KEY_EXCHANGE {
		return nil
	}
	if env.SenderPtid == "" ||
		env.SenderDeviceId == "" ||
		env.RecipientPtid == "" ||
		env.RecipientDeviceId == "" {
		return fmt.Errorf("envelope: DKX requires complete sender and recipient device tuples")
	}
	if env.SenderPtid == env.RecipientPtid &&
		env.SenderDeviceId == env.RecipientDeviceId {
		return fmt.Errorf("envelope: DKX sender and recipient endpoints must differ")
	}
	return nil
}

func (s *DefaultService) enqueueForFederation(ctx context.Context, env *chat.StationEnvelope) (string, error) {
	item := &chat.OutboxItem{
		OutboxItemId:        uuid.NewString(),
		TargetStationPeerId: env.RecipientHomeStationPeerId,
		Envelope:            env,
		Status:              chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_PENDING,
		RetryCount:          0,
	}

	_, err := s.repo.EnqueueOutbox(ctx, item)
	if err != nil {
		return "", fmt.Errorf("envelope: enqueue outbox failed: %w", err)
	}
	return env.EnvelopeId, nil
}

func (s *DefaultService) validateFederationClaims(env *chat.StationEnvelope, claims *FederationClaims) error {
	localID := s.localStationIDFunc()
	if claims.AudienceStationPeerID != localID {
		return fmt.Errorf("audience mismatch: want %s got %s", localID, claims.AudienceStationPeerID)
	}
	if claims.SenderPtid != env.SenderPtid {
		return fmt.Errorf("sender PTID mismatch")
	}
	if claims.ConversationID != "" && claims.ConversationID != env.ConversationId {
		return fmt.Errorf("conversation_id mismatch")
	}
	if claims.IdempotencyKey != "" && claims.IdempotencyKey != env.IdempotencyKey {
		return fmt.Errorf("idempotency_key mismatch")
	}
	if time.Now().After(claims.ExpiresAt) {
		return fmt.Errorf("federation token expired")
	}
	return nil
}
