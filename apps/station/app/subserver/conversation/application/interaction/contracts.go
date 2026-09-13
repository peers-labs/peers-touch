package interaction

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// TypingPulse is an authenticated, bounded, ephemeral Conversation signal.
type TypingPulse struct {
	ConversationID valueobject.ConversationID
	Sender         valueobject.Endpoint
	Generation     uint64
	ExpiresAt      time.Time
	IsTyping       bool
	Scope          string
}

// TypingResult records the accepted expiration without creating durable state.
type TypingResult struct {
	Accepted  bool
	ExpiresAt time.Time
}

// FederatedTypingPhase identifies the authority-mediated signal hop.
type FederatedTypingPhase uint8

const (
	FederatedTypingPhaseAuthorityAdmission FederatedTypingPhase = iota + 1
	FederatedTypingPhaseHomeFanout
)

// FederatedTypingSignal is the application-layer form of the canonical wire signal.
type FederatedTypingSignal struct {
	Phase             FederatedTypingPhase
	FederationID      valueobject.FederationID
	ConversationID    valueobject.ConversationID
	AuthorityStation  valueobject.StationID
	AuthorityEpoch    valueobject.AuthorityEpoch
	Sender            valueobject.Endpoint
	SenderHomeStation valueobject.StationID
	Generation        uint64
	ExpiresAt         time.Time
	IsTyping          bool
	Recipients        []valueobject.PTID
}

// FederatedTypingResult reports best-effort fan-out without durable retry.
type FederatedTypingResult struct {
	Accepted  bool
	Duplicate bool
	Attempted int
	Delivered int
	Dropped   int
}

// ReadCursorRequest advances one actor-scoped Conversation read position.
type ReadCursorRequest struct {
	ConversationID valueobject.ConversationID
	Reader         valueobject.Endpoint
	Sequence       valueobject.Sequence
}

// ReadCursorResult preserves CA-W2's committed result and any post-commit notification failure.
type ReadCursorResult struct {
	Result command.ReadCursorResult
}

// DeliveryReceipt proves that one exact device queue item was durably consumed.
type DeliveryReceipt struct {
	ReceiptID      string
	ConversationID valueobject.ConversationID
	EventID        valueobject.EventID
	Consumer       valueobject.Endpoint
	// SourceStation is the authenticated forwarding peer for a remote receipt.
	// Authority-local receipts leave it empty.
	SourceStation valueobject.StationID
	EventSequence valueobject.Sequence
	LaneSequence  int64
	PayloadHash   valueobject.Hash
	ConsumedAt    time.Time
}

// DeliveryAggregate is the Conversation Delivery projection for one authority event.
type DeliveryAggregate struct {
	ConversationID      valueobject.ConversationID
	EventID             valueobject.EventID
	EventSequence       valueobject.Sequence
	RequiredDeviceCount uint32
	ConsumedDeviceCount uint32
	RevokedDeviceCount  uint32
	Delivered           bool
	FullyDelivered      bool
	Read                bool
}

// DeliveryRecordResult contains the idempotent receipt result and original event author.
type DeliveryRecordResult struct {
	Aggregate        DeliveryAggregate
	MessageID        valueobject.MessageID
	Originator       valueobject.PTID
	OriginatorRoutes []EndpointRoute
	Replay           bool
	Forwarded        bool
}

// ConversationReader is implemented by the CA-W2 query service.
type ConversationReader interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (query.ConversationView, error)
}

// DeviceDirectory exposes actor-owned device eligibility and routing.
type DeviceDirectory interface {
	IsActive(ctx context.Context, endpoint valueobject.Endpoint) (bool, error)
}

// TypingRouteDirectory returns current verified active endpoint routes.
type TypingRouteDirectory interface {
	ListActiveEndpoints(
		ctx context.Context,
		actors []valueobject.PTID,
	) ([]EndpointRoute, error)
}

// EndpointRoute identifies an active actor-owned endpoint and its Home Station.
type EndpointRoute struct {
	Endpoint    valueobject.Endpoint
	HomeStation valueobject.StationID
}

// ReadCursorAdvancer is implemented directly by the CA-W2 command service.
type ReadCursorAdvancer interface {
	AdvanceReadCursor(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		reader valueobject.Endpoint,
		sequence valueobject.Sequence,
	) (command.ReadCursorResult, error)
}

// DeliveryReceiptRecorder validates the exact queue tuple and records it idempotently.
type DeliveryReceiptRecorder interface {
	Record(
		ctx context.Context,
		receipt DeliveryReceipt,
	) (DeliveryRecordResult, error)
}

// DeliveryReceiptCommitter records the authority receipt and all originator
// Device Inbox/Federation effects atomically.
type DeliveryReceiptCommitter interface {
	CommitDeliveryReceipt(
		ctx context.Context,
		receipt DeliveryReceipt,
	) (DeliveryRecordResult, error)
}

// DeliveryReceiptForwarder durably routes a follower-local receipt to the
// Conversation authority. It returns true for an exact replay.
type DeliveryReceiptForwarder interface {
	ForwardDeliveryReceipt(
		ctx context.Context,
		authority valueobject.StationID,
		receipt DeliveryReceipt,
	) (bool, error)
}

// TypingPublisher emits only process-local realtime events.
type TypingPublisher interface {
	PublishTyping(
		ctx context.Context,
		recipient valueobject.PTID,
		pulse TypingPulse,
	) error
}

// TypingFederationDispatcher sends one signed ephemeral frame with no retry.
type TypingFederationDispatcher interface {
	DispatchTyping(
		ctx context.Context,
		target valueobject.StationID,
		signal FederatedTypingSignal,
	) (FederatedTypingResult, error)
}

// FederatedTypingReceiver applies a verified Station-to-Station typing signal.
type FederatedTypingReceiver interface {
	ReceiveFederatedTyping(
		ctx context.Context,
		source valueobject.StationID,
		signal FederatedTypingSignal,
	) (FederatedTypingResult, error)
}

// TypingPulseLedger bounds and deduplicates ephemeral pulse generations.
type TypingPulseLedger interface {
	Admit(
		ctx context.Context,
		pulse TypingPulse,
		now time.Time,
		minimumInterval time.Duration,
	) (TypingResult, error)
}

// Clock supplies deterministic server time.
type Clock interface {
	Now() time.Time
}

// Policy bounds ephemeral pulses and tolerated client clock skew.
type Policy struct {
	MinimumPulseInterval   time.Duration
	MaximumTypingTTL       time.Duration
	MaximumFutureClockSkew time.Duration
}
