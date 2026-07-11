package envelope

import (
	"context"
	"fmt"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"github.com/google/uuid"
)

// DefaultService implements Service with durable outbox/inbox semantics.
type DefaultService struct {
	repo             Repository
	bus              DeviceBus
	localStationID   string
	maxDeliveryAttempts int
}

// NewService creates the envelope application service.
func NewService(repo Repository, bus DeviceBus, localStationID string) *DefaultService {
	return &DefaultService{
		repo:             repo,
		bus:              bus,
		localStationID:   localStationID,
		maxDeliveryAttempts: 20,
	}
}

func (s *DefaultService) Submit(ctx context.Context, env *chat.StationEnvelope) (string, error) {
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
	if err := s.validateFederationClaims(env, claims); err != nil {
		return fmt.Errorf("envelope: federation validation failed: %w", err)
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

func (s *DefaultService) Ack(ctx context.Context, recipientDID, deviceID, inboxItemID string) error {
	return s.repo.MarkInboxAcked(ctx, inboxItemID)
}

func (s *DefaultService) Resume(ctx context.Context, recipientDID, deviceID string, afterCursor string) ([]*chat.DeviceInboxItem, error) {
	return s.repo.UnackedInboxItems(ctx, recipientDID, deviceID, afterCursor, 500)
}

func (s *DefaultService) isLocalRecipient(env *chat.StationEnvelope) bool {
	return env.RecipientHomeStationPeerId == "" || env.RecipientHomeStationPeerId == s.localStationID
}

func (s *DefaultService) deliverLocal(ctx context.Context, env *chat.StationEnvelope) (string, error) {
	item := &chat.DeviceInboxItem{
		InboxItemId:      uuid.NewString(),
		RecipientActorDid: env.RecipientActorDid,
		RecipientDeviceId: env.RecipientDeviceId,
		Envelope:         env,
		Status:           chat.InboxItemStatus_INBOX_ITEM_STATUS_PENDING,
		DeliveryAttempts: 0,
	}

	inboxID, err := s.repo.EnqueueInbox(ctx, item)
	if err != nil {
		return "", fmt.Errorf("envelope: enqueue inbox failed: %w", err)
	}

	if env.RecipientDeviceId != "" {
		delivered := s.bus.PublishToDevice(ctx, env.RecipientActorDid, env.RecipientDeviceId, env)
		if delivered {
			_ = s.repo.MarkInboxDelivered(ctx, inboxID, time.Now())
		}
	} else {
		count := s.bus.PublishToActor(ctx, env.RecipientActorDid, env)
		if count > 0 {
			_ = s.repo.MarkInboxDelivered(ctx, inboxID, time.Now())
		}
	}

	return env.EnvelopeId, nil
}

func (s *DefaultService) enqueueForFederation(ctx context.Context, env *chat.StationEnvelope) (string, error) {
	item := &chat.OutboxItem{
		OutboxItemId:         uuid.NewString(),
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
	if claims.AudienceStationPeerID != s.localStationID {
		return fmt.Errorf("audience mismatch: want %s got %s", s.localStationID, claims.AudienceStationPeerID)
	}
	if claims.SenderActorDID != env.SenderActorDid {
		return fmt.Errorf("sender DID mismatch")
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
