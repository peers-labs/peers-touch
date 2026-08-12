package domain

import (
	"context"
	"errors"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var (
	ErrConsumerFenced     = errors.New("messaging: consumer epoch is fenced")
	ErrQueueItemOwner     = errors.New("messaging: queue item owner mismatch")
	ErrQueueItemOrder     = errors.New("messaging: queue item is not the lane head")
	ErrQueueItemState     = errors.New("messaging: queue item is not claimed")
	ErrPayloadHash        = errors.New("messaging: queue item payload hash mismatch")
	ErrQueueQuotaExceeded = errors.New("messaging: device queue quota exceeded")
)

type QueueLimits struct {
	MaxUnackedItems int64
	MaxUnackedBytes int64
}

type RejectDecision struct {
	Retryable      bool
	ErrorCode      string
	MaxAttempts    uint32
	BaseRetryDelay time.Duration
	MaxRetryDelay  time.Duration
}

type QueueStats struct {
	NextSequence int64
	AckedThrough int64
	Pending      int64
	Claimed      int64
	RetryWait    int64
	Acked        int64
	DeadLetter   int64
	UnackedBytes int64
}

type ClaimResult struct {
	ConsumerEpoch uint64
	Items         []*chat.DeviceQueueItem
	LaneHead      int64
	AckedThrough  int64
}

// QueueRepository owns durable per-device queue persistence and fencing.
type QueueRepository interface {
	Enqueue(ctx context.Context, item *chat.DeviceQueueItem) (*chat.DeviceQueueItem, error)
	Claim(
		ctx context.Context,
		ptid string,
		deviceID string,
		consumerID string,
		expectedConsumerEpoch uint64,
		afterLaneSequence int64,
		limit int,
		now time.Time,
		leaseDuration time.Duration,
	) (*ClaimResult, error)
	Acknowledge(
		ctx context.Context,
		ptid string,
		deviceID string,
		itemID string,
		laneSequence int64,
		consumerEpoch uint64,
		payloadSHA256 []byte,
		now time.Time,
	) (int64, error)
	Reject(
		ctx context.Context,
		ptid string,
		deviceID string,
		itemID string,
		laneSequence int64,
		consumerEpoch uint64,
		decision RejectDecision,
		now time.Time,
	) (*chat.DeviceQueueItem, error)
	Stats(ctx context.Context, ptid string, deviceID string) (*QueueStats, error)
}
