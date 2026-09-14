package federation

import (
	"context"
	"errors"
	"io"

	conversationports "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// ErrAuthorityResultCommandHashMismatch marks a signed result that does not
// belong to the Home Station's persisted outgoing proposal.
var ErrAuthorityResultCommandHashMismatch = errors.New(
	"authority result command hash does not match persisted outgoing proposal",
)

var (
	ErrDeliveryReceiptRejected = errors.New(
		"delivery receipt was rejected by Conversation authority",
	)
	ErrDeliveryReceiptConflict = errors.New(
		"delivery receipt conflicts with Conversation authority state",
	)
	ErrReadCursorRejected = errors.New(
		"read cursor was rejected by Conversation authority",
	)
	ErrReadCursorConflict = errors.New(
		"read cursor conflicts with Conversation authority state",
	)
)

// VerifiedActorDeviceKeyResolver reads identity-owned signing-key projections.
// Implementations must not infer trust from Conversation membership or the
// presence of an unverified actor_devices row.
type VerifiedActorDeviceKeyResolver interface {
	ResolveVerifiedActorDeviceSigningKey(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		actorPTID string,
		expectedHomeStationPeerID string,
		deviceID string,
		signingKeyID string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
}

// FederationMembershipProjection resolves the authenticated Station's current
// membership without assigning governance policy to Conversation.
type FederationMembershipProjection interface {
	IsActiveStation(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		federationID string,
		stationPeerID string,
	) (bool, error)
}

// VerifiedAuthorityCommand carries the exact D-17 bytes and verified identity
// projection into the Conversation authority transaction.
type VerifiedAuthorityCommand struct {
	Proposal              *chatmodel.ConversationCommandProposal
	SourceHomeStation     string
	CanonicalCommandBytes []byte
	CanonicalSigningBytes []byte
	VerifiedSigningKey    *actormodel.VerifiedActorDeviceSigningKey
	KeyCurrentlyRevoked   bool
}

// AuthorityCommandOutcome is produced by the canonical Conversation receipt
// and command unit of work. Replay must mean that the exact stored result was
// returned without allocating another authority sequence or fan-out.
type AuthorityCommandOutcome struct {
	Result *chatmodel.ConversationCommandProposalResult
	Replay bool
}

// AuthorityCommandPort applies a verified command using the delivery-owned SQL
// transaction so the Federation inbox receipt, command receipt, authority
// event, and result outbox remain one atomic commit.
type AuthorityCommandPort interface {
	ApplyAuthorityCommand(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		command VerifiedAuthorityCommand,
	) (AuthorityCommandOutcome, error)
}

// AuthorityResultPort atomically stores a Home Station command result and its
// addressed device-inbox effect. The originating command hash comes from the
// signed Federation frame and must match the persisted outgoing proposal. It
// returns true only for an exact replay.
type AuthorityResultPort interface {
	ApplyAuthorityResult(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		result *chatmodel.ConversationCommandResultDelivery,
		originatingCommandSHA256 []byte,
		sourceAuthorityStationPeerID string,
	) (bool, error)
}

// ReadCursorPort applies an actor-scoped cursor at the Conversation authority.
// The source Home Station is supplied only from the authenticated Federation frame.
type ReadCursorPort interface {
	ApplyReadCursor(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		cursor *chatmodel.FederatedConversationReadCursor,
		sourceHomeStationPeerID string,
	) error
}

// DeviceDeliveryPort atomically applies an authority event to the follower
// projection and enqueues the target-local intent. The canonical Device Inbox
// repository allocates lane sequence; remote Stations never supply it.
type DeviceDeliveryPort interface {
	ApplyDeviceDelivery(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		intent conversationports.DeviceInboxIntent,
		sourceAuthorityStationPeerID string,
	) (bool, error)
}

// DeliveryReceiptPort applies a receipt at the Conversation authority. The
// source Home Station is supplied only from the authenticated Federation frame.
type DeliveryReceiptPort interface {
	ApplyDeliveryReceipt(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		receipt *chatmodel.DeviceConsumptionReceipt,
		sourceHomeStationPeerID string,
	) (bool, error)
}

// EndpointManifestPort is the peer-authenticated Actor Identity manifest edge.
type EndpointManifestPort interface {
	GetEndpointManifest(
		ctx context.Context,
		sourceStationPeerID string,
		request *actormodel.GetActorEndpointManifestRequest,
	) (*actormodel.GetActorEndpointManifestResponse, error)
}

// MLSKeyPackageClaimPort is the peer-authenticated Key Exchange claim edge.
type MLSKeyPackageClaimPort interface {
	ClaimMLSKeyPackage(
		ctx context.Context,
		sourceAuthorityStationPeerID string,
		request *keyexchangemodel.ClaimMlsKeyPackageRequest,
	) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error)
}

// LeaveIntentPort is the peer-authenticated Conversation leave-intent edge.
type LeaveIntentPort interface {
	SubmitLeaveIntent(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.SubmitFederatedMlsLeaveIntentRequest,
	) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error)
	ListLeaveIntents(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.ListFederatedMlsLeaveIntentsRequest,
	) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error)
}

// EventSyncPort is the peer-authenticated authority event catch-up edge.
type EventSyncPort interface {
	SyncAuthorityEvents(
		ctx context.Context,
		sourceFollowerStationPeerID string,
		request *chatmodel.SyncAuthorityConversationEventsRequest,
	) (*chatmodel.SyncAuthorityConversationEventsResponse, error)
}

// AttachmentDataPlanePort keeps raw ciphertext streaming separate from its
// canonical protobuf metadata. All methods receive the authenticated source
// Station independently of client-controlled request fields.
type AttachmentDataPlanePort interface {
	GetUpload(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.GetFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.GetFederatedConversationAttachmentUploadResponse, error)
	BeginUpload(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.BeginFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.BeginFederatedConversationAttachmentUploadResponse, error)
	PutChunk(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.PutFederatedConversationAttachmentChunkRequest,
		body io.Reader,
	) (*chatmodel.PutFederatedConversationAttachmentChunkResponse, error)
	CompleteUpload(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.CompleteFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.CompleteFederatedConversationAttachmentUploadResponse, error)
	CancelUpload(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.CancelFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.CancelFederatedConversationAttachmentUploadResponse, error)
	GetObject(
		ctx context.Context,
		sourceHomeStationPeerID string,
		request *chatmodel.GetFederatedConversationAttachmentObjectRequest,
		startInclusive int64,
		endInclusive int64,
	) (*chatmodel.GetFederatedConversationAttachmentObjectResponse, io.ReadCloser, error)
}
