package worker

import (
	"context"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type FederationDeliveryResult struct {
	Delivered bool
	Retryable bool
	ErrorCode string
}

type FederationTransport interface {
	Deliver(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
	) FederationDeliveryResult
}

type FederationDispatcherPolicy struct {
	BatchSize     int
	LeaseDuration time.Duration
	MaxAttempts   uint32
	BaseBackoff   time.Duration
	MaxBackoff    time.Duration
}

type FederationDispatcher struct {
	dispatcherID string
	repository   messaging.FederationOutboxRepository
	transport    FederationTransport
	policy       FederationDispatcherPolicy
	clock        func() time.Time
}

func NewFederationDispatcher(
	dispatcherID string,
	repository messaging.FederationOutboxRepository,
	transport FederationTransport,
	policy FederationDispatcherPolicy,
	clock func() time.Time,
) (*FederationDispatcher, error) {
	if dispatcherID == "" ||
		repository == nil ||
		transport == nil ||
		clock == nil ||
		policy.BatchSize <= 0 ||
		policy.BatchSize > 100 ||
		policy.LeaseDuration <= 0 ||
		policy.MaxAttempts == 0 ||
		policy.BaseBackoff <= 0 ||
		policy.MaxBackoff < policy.BaseBackoff {
		return nil, fmt.Errorf("messaging: invalid federation dispatcher configuration")
	}
	return &FederationDispatcher{
		dispatcherID: dispatcherID,
		repository:   repository,
		transport:    transport,
		policy:       policy,
		clock:        clock,
	}, nil
}

func (d *FederationDispatcher) DispatchOnce(ctx context.Context) (int, error) {
	now := d.clock().UTC()
	claims, err := d.repository.ClaimFederationFrames(
		ctx,
		d.dispatcherID,
		d.policy.BatchSize,
		now,
		d.policy.LeaseDuration,
	)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, claim := range claims {
		if ctx.Err() != nil {
			return processed, ctx.Err()
		}
		result := d.transport.Deliver(ctx, claim.Frame)
		if result.Delivered {
			if err := d.repository.MarkFederationDelivered(
				ctx,
				claim.Frame.FrameId,
				d.dispatcherID,
				claim.LeaseGeneration,
				d.clock().UTC(),
			); err != nil {
				return processed, err
			}
			processed++
			continue
		}
		if result.ErrorCode == "" {
			return processed, fmt.Errorf("messaging: federation transport returned no error code")
		}
		if !result.Retryable || claim.AttemptCount >= d.policy.MaxAttempts {
			if err := d.repository.MarkFederationDeadLetter(
				ctx,
				claim.Frame.FrameId,
				d.dispatcherID,
				claim.LeaseGeneration,
				result.ErrorCode,
			); err != nil {
				return processed, err
			}
			processed++
			continue
		}
		nextAttemptAt := d.clock().UTC().Add(backoff(
			claim.AttemptCount,
			d.policy.BaseBackoff,
			d.policy.MaxBackoff,
		))
		if err := d.repository.ScheduleFederationRetry(
			ctx,
			claim.Frame.FrameId,
			d.dispatcherID,
			claim.LeaseGeneration,
			nextAttemptAt,
			result.ErrorCode,
		); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func backoff(attempt uint32, base time.Duration, maximum time.Duration) time.Duration {
	value := base
	for current := uint32(1); current < attempt; current++ {
		if value >= maximum/2 {
			return maximum
		}
		value *= 2
	}
	if value > maximum {
		return maximum
	}
	return value
}
