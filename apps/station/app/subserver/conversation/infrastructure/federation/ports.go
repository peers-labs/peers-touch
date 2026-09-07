package federation

import (
	"context"
	"io"

	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// VerifiedActorDeviceKeyResolver reads identity-owned signing-key projections.
// Implementations must not infer trust from Conversation membership or the
// presence of an unverified actor_devices row.
type VerifiedActorDeviceKeyResolver interface {
	ResolveVerifiedActorDeviceSigningKey(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		actorPTID string,
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
// addressed device-inbox effect. It returns true only for an exact replay.
type AuthorityResultPort interface {
	ApplyAuthorityResult(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		result *chatmodel.ConversationCommandResultDelivery,
		sourceAuthorityStationPeerID string,
	) (bool, error)
}

// DeviceDeliveryPort atomically applies an authority event to the follower
// projection and enqueues the enclosed local device item. It returns true only
// for an exact replay.
type DeviceDeliveryPort interface {
	ApplyDeviceDelivery(
		ctx context.Context,
		transaction federationdelivery.Transaction,
		item *chatmodel.DurableDeviceInboxItem,
		sourceAuthorityStationPeerID string,
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
