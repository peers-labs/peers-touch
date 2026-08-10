package domain

import (
	"context"
	"errors"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	FederationScope                = "messaging-frame-deliver"
	FederationClaimFrameID         = "frame_id"
	FederationClaimIdempotencyKey  = "idempotency_key"
	FederationClaimSourceStationID = "source_station_id"
	FederationClaimTargetStationID = "target_station_id"
)

var (
	ErrFederationFrameInvalid     = errors.New("messaging: federation frame is invalid")
	ErrFederationFrameSignature   = errors.New("messaging: federation frame signature is invalid")
	ErrFederationFrameConflict    = errors.New("messaging: federation frame idempotency conflict")
	ErrFederationFrameExpired     = errors.New("messaging: federation frame is expired")
	ErrFederationDispatcherFenced = errors.New("messaging: federation dispatcher lease is fenced")
)

type FederationOutboxClaim struct {
	Frame           *chat.MessagingFederationFrame
	LeaseGeneration uint64
	AttemptCount    uint32
}

type FederationFrameSigner interface {
	SignFederationFrame(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
	) error
}

type FederationFrameSignFunc func(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) error

func (fn FederationFrameSignFunc) SignFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) error {
	return fn(ctx, frame)
}

type FederationOutboxRepository interface {
	EnqueueFederationFrame(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
		now time.Time,
	) error
	ClaimFederationFrames(
		ctx context.Context,
		dispatcherID string,
		limit int,
		now time.Time,
		leaseDuration time.Duration,
	) ([]FederationOutboxClaim, error)
	MarkFederationDelivered(
		ctx context.Context,
		frameID string,
		dispatcherID string,
		leaseGeneration uint64,
		deliveredAt time.Time,
	) error
	ScheduleFederationRetry(
		ctx context.Context,
		frameID string,
		dispatcherID string,
		leaseGeneration uint64,
		nextAttemptAt time.Time,
		errorCode string,
	) error
	MarkFederationDeadLetter(
		ctx context.Context,
		frameID string,
		dispatcherID string,
		leaseGeneration uint64,
		errorCode string,
	) error
}

type FederationInboxUnitOfWork interface {
	IngestFederationFrame(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
		receivedAt time.Time,
		fn func(queue QueueRepository) error,
	) (duplicate bool, err error)
}
