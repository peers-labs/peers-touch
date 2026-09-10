package application

import (
	"context"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
)

// EnsureDirectConversationRequest carries the durable Social effect identity.
type EnsureDirectConversationRequest struct {
	EffectID     string
	RequestID    string
	FederationID string
	ActorAPTID   string
	ActorBPTID   string
}

// DirectConversationPort creates or returns one Direct Conversation idempotently.
type DirectConversationPort interface {
	EnsureDirectConversation(
		ctx context.Context,
		request EnsureDirectConversationRequest,
	) (conversationID string, err error)
}

// FriendRequestDirectEffectPolicy bounds lease and retry behavior.
type FriendRequestDirectEffectPolicy struct {
	LeaseDuration time.Duration
	RetryInitial  time.Duration
	RetryMaximum  time.Duration
}

// FriendRequestDirectEffectService delivers durable post-accept Conversation effects.
type FriendRequestDirectEffectService struct {
	store  infrastructure.DirectConversationEffectStore
	port   DirectConversationPort
	clock  delivery.Clock
	policy FriendRequestDirectEffectPolicy
}

// NewFriendRequestDirectEffectService constructs the idempotent effect worker.
func NewFriendRequestDirectEffectService(
	store infrastructure.DirectConversationEffectStore,
	port DirectConversationPort,
	clock delivery.Clock,
	policy FriendRequestDirectEffectPolicy,
) (*FriendRequestDirectEffectService, error) {
	if store == nil ||
		port == nil ||
		clock == nil ||
		policy.LeaseDuration <= 0 ||
		policy.RetryInitial <= 0 ||
		policy.RetryMaximum < policy.RetryInitial {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.new_friend_request_direct_effect_service",
			"dependencies",
			"store, port, clock, and bounded retry policy are required",
		)
	}
	return &FriendRequestDirectEffectService{
		store:  store,
		port:   port,
		clock:  clock,
		policy: policy,
	}, nil
}

// ProcessOne claims and resolves at most one durable Direct Conversation effect.
func (s *FriendRequestDirectEffectService) ProcessOne(
	ctx context.Context,
	workerID string,
) (bool, error) {
	now := s.clock.Now().UTC()
	claim, found, err := s.store.ClaimDirectConversationEffect(
		ctx,
		workerID,
		now,
		s.policy.LeaseDuration,
	)
	if err != nil || !found {
		return false, err
	}
	conversationID, err := s.port.EnsureDirectConversation(
		ctx,
		EnsureDirectConversationRequest{
			EffectID:     claim.Effect.EffectID,
			RequestID:    claim.Effect.RequestID,
			FederationID: claim.Effect.FederationID,
			ActorAPTID:   claim.Effect.ActorAPTID,
			ActorBPTID:   claim.Effect.ActorBPTID,
		},
	)
	if err != nil {
		retryAt := s.clock.Now().UTC().Add(effectRetryDelay(
			claim.AttemptCount,
			s.policy.RetryInitial,
			s.policy.RetryMaximum,
		))
		if retryErr := s.store.RetryDirectConversationEffect(
			ctx,
			claim,
			retryAt,
			"conversation_port_error",
		); retryErr != nil {
			return true, retryErr
		}
		return true, err
	}
	if conversationID == "" {
		err := domain.NewFederationError(
			domain.FederationErrorStateConflict,
			"social.process_friend_request_direct_effect",
			"conversation_id",
			"typed Conversation port returned an empty identity",
		)
		retryAt := s.clock.Now().UTC().Add(effectRetryDelay(
			claim.AttemptCount,
			s.policy.RetryInitial,
			s.policy.RetryMaximum,
		))
		if retryErr := s.store.RetryDirectConversationEffect(
			ctx,
			claim,
			retryAt,
			"empty_conversation_id",
		); retryErr != nil {
			return true, retryErr
		}
		return true, err
	}
	if err := s.store.CompleteDirectConversationEffect(
		ctx,
		claim,
		conversationID,
		s.clock.Now().UTC(),
	); err != nil {
		return true, err
	}
	return true, nil
}

func effectRetryDelay(
	attempt uint32,
	initial time.Duration,
	maximum time.Duration,
) time.Duration {
	delay := initial
	for current := uint32(1); current < attempt; current++ {
		if delay >= maximum || delay > maximum/2 {
			return maximum
		}
		delay *= 2
	}
	return delay
}
