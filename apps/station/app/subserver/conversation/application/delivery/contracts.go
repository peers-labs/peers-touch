package delivery

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// PayloadType identifies the opaque device payload without interpreting its contents.
type PayloadType int32

const (
	PayloadTypeConversationEvent PayloadType = 1
	PayloadTypeDirectSessionInit PayloadType = 2
	PayloadTypeMLSTransition     PayloadType = 3
	PayloadTypeCommandResult     PayloadType = 4
	PayloadTypeDeviceReceipt     PayloadType = 5
)

// ItemState is the application-level state of a durable inbox item.
type ItemState string

const (
	ItemStatePending    ItemState = "pending"
	ItemStateClaimed    ItemState = "claimed"
	ItemStateRetryWait  ItemState = "retry_wait"
	ItemStateConsumed   ItemState = "consumed"
	ItemStateAcked      ItemState = "acked"
	ItemStateDeadLetter ItemState = "dead_letter"
)

// RejectCode classifies a consumer rejection without accepting arbitrary error text.
type RejectCode string

const (
	RejectCodePayloadInvalid         RejectCode = "payload_invalid"
	RejectCodeCryptoStateUnavailable RejectCode = "crypto_state_unavailable"
	RejectCodeIntegrityFailed        RejectCode = "integrity_failed"
	RejectCodeRecipientMismatch      RejectCode = "recipient_mismatch"
	RejectCodeRetryLater             RejectCode = "retry_later"
)

// Retryable reports whether the canonical rejection permits bounded redelivery.
func (c RejectCode) Retryable() bool {
	switch c {
	case RejectCodeCryptoStateUnavailable, RejectCodeRetryLater:
		return true
	default:
		return false
	}
}

// Valid reports whether the rejection code belongs to the canonical contract.
func (c RejectCode) Valid() bool {
	switch c {
	case RejectCodePayloadInvalid,
		RejectCodeCryptoStateUnavailable,
		RejectCodeIntegrityFailed,
		RejectCodeRecipientMismatch,
		RejectCodeRetryLater:
		return true
	default:
		return false
	}
}

// Lease binds a claimed item to one consumer generation until its expiry.
type Lease struct {
	ConsumerID    string
	ConsumerEpoch uint64
	ExpiresAt     time.Time
}

// Item is one opaque delivery in a device-specific ordered lane.
type Item struct {
	ItemID         string
	Recipient      valueobject.Endpoint
	LaneSequence   int64
	EventID        valueobject.EventID
	EventSequence  valueobject.Sequence
	ConversationID valueobject.ConversationID
	IdempotencyKey string
	PayloadType    PayloadType
	OpaquePayload  []byte
	PayloadHash    valueobject.Hash
	State          ItemState
	AttemptCount   uint32
	Lease          *Lease
	FirstQueuedAt  time.Time
	NextAttemptAt  time.Time
	ExpiresAt      *time.Time
	ConsumedAt     *time.Time
	AckedAt        *time.Time
	LastRejectCode RejectCode
}

// EnqueueRequest contains the transaction-scoped data needed to append one delivery.
type EnqueueRequest struct {
	ItemID         string
	Recipient      valueobject.Endpoint
	EventID        valueobject.EventID
	EventSequence  valueobject.Sequence
	ConversationID valueobject.ConversationID
	IdempotencyKey string
	PayloadType    PayloadType
	OpaquePayload  []byte
	PayloadHash    valueobject.Hash
	CreatedAt      time.Time
}

// ClaimRequest requests a bounded, contiguous lease from one device lane.
type ClaimRequest struct {
	Recipient             valueobject.Endpoint
	ConsumerID            string
	ExpectedConsumerEpoch uint64
	AfterLaneSequence     int64
	Limit                 int
	Now                   time.Time
	LeaseDuration         time.Duration
}

// ClaimResult contains the persisted consumer epoch and any contiguous claimed items.
type ClaimResult struct {
	ConsumerEpoch uint64
	Items         []Item
	LaneHead      int64
	AckedThrough  int64
}

// AcknowledgeRequest advances a lane after durable local consumption.
type AcknowledgeRequest struct {
	Recipient     valueobject.Endpoint
	ItemID        string
	LaneSequence  int64
	ConsumerEpoch uint64
	PayloadHash   valueobject.Hash
	Now           time.Time
}

// RejectRequest applies canonical retry or dead-letter policy to the current lane head.
type RejectRequest struct {
	Recipient      valueobject.Endpoint
	ItemID         string
	LaneSequence   int64
	ConsumerEpoch  uint64
	Code           RejectCode
	Retryable      bool
	MaxAttempts    uint32
	BaseRetryDelay time.Duration
	MaxRetryDelay  time.Duration
	Now            time.Time
}

// RejectResult describes the durable state after rejecting a claimed item.
type RejectResult struct {
	State         ItemState
	NextAttemptAt *time.Time
}

// QueueStats exposes bounded operational state without interpreting payload content.
type QueueStats struct {
	NextSequence int64
	AckedThrough int64
	Pending      int64
	Claimed      int64
	RetryWait    int64
	Consumed     int64
	Acked        int64
	DeadLetter   int64
	UnackedBytes int64
}

// QueueLimits bounds durable per-device pressure at command admission time.
type QueueLimits struct {
	MaxUnackedItems int64
	MaxUnackedBytes int64
}

// Policy defines bounded claim and retry behavior.
type Policy struct {
	LeaseDuration  time.Duration
	MaxBatchSize   uint32
	MaxAttempts    uint32
	BaseRetryDelay time.Duration
	MaxRetryDelay  time.Duration
}

// Repository owns the canonical device_queue_lanes and device_queue_items state machine.
type Repository interface {
	Enqueue(ctx context.Context, request EnqueueRequest) (Item, error)
	Claim(ctx context.Context, request ClaimRequest) (ClaimResult, error)
	Acknowledge(ctx context.Context, request AcknowledgeRequest) (int64, error)
	Reject(ctx context.Context, request RejectRequest) (RejectResult, error)
	Stats(ctx context.Context, recipient valueobject.Endpoint) (QueueStats, error)
}

// DeviceAccess verifies current actor-owned device eligibility before queue mutation.
type DeviceAccess interface {
	IsActive(ctx context.Context, endpoint valueobject.Endpoint) (bool, error)
}

// Clock supplies deterministic UTC timestamps to the delivery application service.
type Clock interface {
	Now() time.Time
}

// PayloadTypeFromIntent maps a CA-W2 delivery intent to the canonical inbox payload type.
func PayloadTypeFromIntent(kind ports.DeviceInboxPayloadKind) (PayloadType, error) {
	switch kind {
	case ports.DeviceInboxPayloadConversationEvent:
		return PayloadTypeConversationEvent, nil
	case ports.DeviceInboxPayloadDeviceReceipt:
		return PayloadTypeDeviceReceipt, nil
	default:
		return 0, NewError(
			ErrorCodeInvalidArgument,
			"delivery.payload_type_from_intent",
			"payload_kind",
			"is not supported",
		)
	}
}
