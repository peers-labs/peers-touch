package ports

import (
	"context"
	"time"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type EndpointRoute struct {
	Endpoint    valueobject.Endpoint
	HomeStation valueobject.StationID
}

type DeviceInboxPayloadKind string

const (
	DeviceInboxPayloadConversationEvent DeviceInboxPayloadKind = "conversation_event"
	DeviceInboxPayloadDeviceReceipt     DeviceInboxPayloadKind = "device_receipt"
)

// DeviceSignatureVerification keeps historical replay authentication separate
// from current device admission.
type DeviceSignatureVerification struct {
	KeyRevoked bool
}

type IdentityDirectory interface {
	IsActive(ctx context.Context, endpoint valueobject.Endpoint) (bool, error)
	ActorIdentityPublicKey(ctx context.Context, actor valueobject.PTID) ([]byte, error)
	VerifyDeviceSignature(
		ctx context.Context,
		endpoint valueobject.Endpoint,
		signingKeyID string,
		payload []byte,
		signature []byte,
	) (DeviceSignatureVerification, error)
	ListActiveEndpoints(
		ctx context.Context,
		actors []valueobject.PTID,
	) ([]EndpointRoute, error)
}

type FederationDirectory interface {
	IsActiveStation(
		ctx context.Context,
		federationID valueobject.FederationID,
		station valueobject.StationID,
	) (bool, error)
}

type DeviceInboxIntent struct {
	IntentID       string
	ConversationID valueobject.ConversationID
	EventID        valueobject.EventID
	EventSequence  valueobject.Sequence
	Recipient      valueobject.Endpoint
	IdempotencyKey string
	PayloadKind    DeviceInboxPayloadKind
	OpaquePayload  []byte
	PayloadHash    valueobject.Hash
	Commitment     valueobject.Hash
	CreatedAt      time.Time
}

type DeviceInboxWriter interface {
	Enqueue(ctx context.Context, intent DeviceInboxIntent) error
}

type FederationOutboxIntent struct {
	IntentID       string
	ConversationID valueobject.ConversationID
	EventID        valueobject.EventID
	EventSequence  valueobject.Sequence
	Recipient      valueobject.Endpoint
	TargetStation  valueobject.StationID
	IdempotencyKey string
	PayloadKind    DeviceInboxPayloadKind
	OpaquePayload  []byte
	PayloadHash    valueobject.Hash
	CreatedAt      time.Time
}

type FederationOutboxWriter interface {
	Enqueue(ctx context.Context, intent FederationOutboxIntent) error
}

type ObjectGrant struct {
	ObjectID       valueobject.ObjectID
	ConversationID valueobject.ConversationID
	EventID        valueobject.EventID
	Recipient      valueobject.PTID
	GrantedAt      time.Time
}

type ObjectGrantWriter interface {
	Grant(ctx context.Context, grant ObjectGrant) error
}

type KeyPackageReservations interface {
	Reserve(
		ctx context.Context,
		planID valueobject.PlanID,
		endpoints []valueobject.Endpoint,
		expiresAt time.Time,
	) ([]valueobject.KeyPackageReservation, error)
	Consume(
		ctx context.Context,
		reservations []valueobject.KeyPackageReservation,
		at time.Time,
	) error
	Release(
		ctx context.Context,
		reservations []valueobject.KeyPackageReservation,
		at time.Time,
	) error
}

type Transaction struct {
	Repositories           repository.Repositories
	Identity               IdentityDirectory
	Federation             FederationDirectory
	DeviceInbox            DeviceInboxWriter
	FederationOutbox       FederationOutboxWriter
	ObjectGrants           ObjectGrantWriter
	KeyPackageReservations KeyPackageReservations
}

type UnitOfWork interface {
	Execute(ctx context.Context, fn func(Transaction) error) error
	ExecuteSerialized(
		ctx context.Context,
		key string,
		fn func(Transaction) error,
	) error
}

type CommittedDelivery struct {
	Recipient valueobject.Endpoint
	EventID   valueobject.EventID
}

type PostCommitPublisher interface {
	NotifyCommitted(ctx context.Context, deliveries []CommittedDelivery) error
}

type Clock interface {
	Now() time.Time
}

type IDGenerator interface {
	NewPlanID() valueobject.PlanID
}

type ConversationStateEncoder interface {
	EncodeConversationStateMarker(
		conversationID valueobject.ConversationID,
		eventID valueobject.EventID,
	) ([]byte, error)
}

type DeviceEventEncoder interface {
	EncodeDeviceEvent(
		event domainevent.Record,
		delivery valueobject.PreparedDelivery,
		commitment valueobject.Hash,
		senderActorIdentityPublicKey []byte,
	) ([]byte, error)
}

type ReadCursorEncoder interface {
	EncodeReadCursor(cursor repository.ReadCursor) ([]byte, error)
}

type LeaveIntentSigningInput struct {
	Version             uint32
	IntentID            string
	FederationID        valueobject.FederationID
	AuthorityStation    valueobject.StationID
	AuthorityEpoch      valueobject.AuthorityEpoch
	HomeStation         valueobject.StationID
	ConversationID      valueobject.ConversationID
	Actor               valueobject.Endpoint
	SigningKeyID        string
	AuthorityHead       valueobject.AuthorityHead
	CreatedAtUnixMillis int64
	ExpiresAtUnixMillis int64
}

type LeaveIntentSigningEncoder interface {
	EncodeLeaveIntentSigningInput(input LeaveIntentSigningInput) ([]byte, error)
}

type CommandProposalSigningInput struct {
	Version             uint32
	FederationID        valueobject.FederationID
	AuthorityStation    valueobject.StationID
	AuthorityEpoch      valueobject.AuthorityEpoch
	HomeStation         valueobject.StationID
	ConversationID      valueobject.ConversationID
	CommandID           valueobject.CommandID
	CommandKind         domainevent.Kind
	Actor               valueobject.Endpoint
	SigningKeyID        string
	CommandHash         valueobject.Hash
	CreatedAtUnixMillis int64
	ExpiresAtUnixMillis int64
}

type CommandProposalSigningEncoder interface {
	EncodeCommandProposalSigningInput(input CommandProposalSigningInput) ([]byte, error)
}
