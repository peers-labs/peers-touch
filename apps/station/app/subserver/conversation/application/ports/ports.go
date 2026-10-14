package ports

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type EndpointRoute struct {
	Endpoint    valueobject.Endpoint
	HomeStation valueobject.StationID
}

// GroupRecipientMember is the stable Conversation-owned recipient projection
// exposed to co-located consumers.
type GroupRecipientMember struct {
	ActorPTID         string
	HomeStationPeerID string
}

// GroupRecipientSnapshot freezes the active Group membership authority needed
// by a caller without exposing Conversation repositories or transactions.
type GroupRecipientSnapshot struct {
	ConversationID      string
	AuthorPTID          string
	MembershipEpoch     uint64
	AuthorityHeadSHA256 []byte
	Members             []GroupRecipientMember
}

type DeviceInboxPayloadKind string

const (
	DeviceInboxPayloadConversationEvent DeviceInboxPayloadKind = "conversation_event"
	DeviceInboxPayloadCommandResult     DeviceInboxPayloadKind = "command_result"
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

// SystemSenderAuthorization verifies one live Conversation-owned delegation.
type SystemSenderAuthorization interface {
	AuthorizeSystemMessage(
		ctx context.Context,
		publishingID string,
		sender valueobject.PTID,
		conversation valueobject.ConversationID,
		at time.Time,
	) error
}

// PublishingStore uses the exact authority transaction for credentials,
// frozen receipts, object ownership, and bounded producer admission.
type PublishingStore interface {
	GetGrant(ctx context.Context, id string) (entity.PublishingGrant, error)
	CreateGrant(ctx context.Context, grant entity.PublishingGrant) error
	SaveGrant(ctx context.Context, grant entity.PublishingGrant) error
	ListGrants(ctx context.Context, owner valueobject.PTID) ([]entity.PublishingGrant, error)
	GetPublication(ctx context.Context, id, commandID string) (entity.PublicationReceipt, bool, error)
	RecordPublication(ctx context.Context, receipt entity.PublicationReceipt) error
	CheckRate(ctx context.Context, id string, limit uint32, at time.Time) error
}

type PublishedObjectDirectory interface {
	ValidateObject(ctx context.Context, objectID string, owner valueobject.PTID, target valueobject.ConversationID, at time.Time) (PublishedObject, error)
}

type PublishedObject struct {
	ID        string
	Filename  string
	MediaType string
	Size      uint64
}

// ServiceNotificationInput is a transaction-bound internal notification
// production request. The implementation honors recipient
// preferences and an idempotency key without leaving the caller transaction.
type ServiceNotificationInput struct {
	RecipientPTID  string
	ActorPTID      string
	Type           int32
	Category       int32
	TargetType     string
	TargetID       string
	Title          string
	Body           string
	GroupKey       string
	IdempotencyKey string
	Metadata       map[string]string
}

// ServiceNotificationResult reports whether a fresh notification committed.
// NotificationID is the stable row id, used post-commit for the realtime wake.
type ServiceNotificationResult struct {
	Produced       bool
	NotificationID string
}

// ServiceNotificationProducer writes a notification row inside the delivery
// transaction. A zero Produced means a muted preference or an idempotent
// replay; the causing message is still committed either way.
type ServiceNotificationProducer interface {
	ProduceInTx(
		ctx context.Context,
		input ServiceNotificationInput,
		at time.Time,
	) (ServiceNotificationResult, error)
}

// ServiceNotificationWake is the post-commit actor-level realtime descriptor.
// The durable notification row
// and the device inbox remain truth; this wake only reaches currently (and
// ring-replaying) online owner devices and must never gate the webhook result.
type ServiceNotificationWake struct {
	RecipientActor   valueobject.PTID
	NotificationID   string
	NotificationType int32
	Category         int32
	GroupKey         string
	CreatedAtUnixMs  int64
}

// ServiceNotificationPublisher emits the actor-level notification wake after
// the delivery transaction commits.
type ServiceNotificationPublisher interface {
	PublishServiceNotification(ctx context.Context, wake ServiceNotificationWake) error
}

// LocalScope resolves the internal Federation scope for system-authored
// conversations (no client-supplied Federation id; v1 home-local only).
type LocalScope interface {
	LocalFederation(ctx context.Context) (
		federationID valueobject.FederationID,
		authorityEpoch valueobject.AuthorityEpoch,
		err error,
	)
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

// AuthorityDeliveryCommitment preserves the exact endpoint delivery accepted
// with an authority event without retaining endpoint-private payload bytes.
type AuthorityDeliveryCommitment struct {
	ConversationID      valueobject.ConversationID
	EventID             valueobject.EventID
	EventSequence       valueobject.Sequence
	Originator          valueobject.PTID
	Recipient           valueobject.Endpoint
	HomeStation         valueobject.StationID
	PayloadKind         valueobject.DeliveryKind
	EndpointPayloadHash valueobject.Hash
	Commitment          valueobject.Hash
	QueueItemID         string
	QueuePayloadHash    valueobject.Hash
	RequiredRecipient   bool
	CreatedAt           time.Time
}

// AuthorityDeliveryCommitmentWriter persists the complete endpoint commitment
// set in the same transaction as its event and delivery intents.
type AuthorityDeliveryCommitmentWriter interface {
	RecordCommitments(
		ctx context.Context,
		commitments []AuthorityDeliveryCommitment,
	) error
}

type ObjectGrantBatch struct {
	ConversationID valueobject.ConversationID
	MessageID      valueobject.MessageID
	Uploader       valueobject.PTID
	EventID        valueobject.EventID
	ObjectIDs      []valueobject.ObjectID
	Recipients     []valueobject.PTID
	GrantedAt      time.Time
}

type ObjectGrantWriter interface {
	GrantBatch(ctx context.Context, grant ObjectGrantBatch) error
}

type KeyPackageReservations interface {
	Reserve(
		ctx context.Context,
		planID valueobject.PlanID,
		routes []EndpointRoute,
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
	SystemSender           SystemSenderAuthorization
	Publishing             PublishingStore
	PublishingObjects      PublishedObjectDirectory
	ServiceNotifications   ServiceNotificationProducer
	LocalScope             LocalScope
	DeviceInbox            DeviceInboxWriter
	FederationOutbox       FederationOutboxWriter
	DeliveryCommitments    AuthorityDeliveryCommitmentWriter
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
