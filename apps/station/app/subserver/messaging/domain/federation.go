package domain

import (
	"context"
	"errors"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	FederationClockSkewBudget           = time.Minute
	FederationScope                     = "messaging-frame-deliver"
	EndpointManifestScope               = "messaging-endpoint-manifest-read"
	AuthorityPrepareScope               = "messaging-authority-prepare"
	MlsKeyPackageClaimScope             = "messaging-mls-key-package-claim"
	AttachmentTransferScope             = "messaging-attachment-transfer"
	FederationClaimFrameID              = "frame_id"
	FederationClaimIdempotencyKey       = "idempotency_key"
	FederationClaimSourceStationID      = "source_station_id"
	FederationClaimTargetStationID      = "target_station_id"
	FederationClaimActorPTID            = "actor_ptid"
	FederationClaimConversationID       = "conversation_id"
	FederationClaimAuthorityPlanID      = "authority_plan_id"
	FederationClaimTargetPTID           = "target_ptid"
	FederationClaimTargetDeviceID       = "target_device_id"
	FederationClaimPlanExpiresAt        = "plan_expires_at"
	FederationClaimDeviceID             = "device_id"
	FederationClaimAttachmentAction     = "attachment_action"
	FederationClaimAttachmentResourceID = "attachment_resource_id"
)

var (
	ErrFederationFrameInvalid     = errors.New("messaging: federation frame is invalid")
	ErrFederationFrameSignature   = errors.New("messaging: federation frame signature is invalid")
	ErrFederationFrameConflict    = errors.New("messaging: federation frame idempotency conflict")
	ErrFederationFrameExpired     = errors.New("messaging: federation frame is expired")
	ErrFederationDispatcherFenced = errors.New("messaging: federation dispatcher lease is fenced")
	ErrEndpointManifestInvalid    = errors.New("messaging: endpoint manifest is invalid")
	ErrEndpointManifestSignature  = errors.New("messaging: endpoint manifest signature is invalid")
	ErrEndpointManifestExpired    = errors.New("messaging: endpoint manifest is expired")
	ErrEndpointManifestRollback   = errors.New("messaging: endpoint manifest version rollback")
	ErrEndpointManifestConflict   = errors.New("messaging: endpoint manifest version conflict")
	ErrMlsKeyPackageClaimConflict = errors.New("messaging: MLS KeyPackage claim conflicts with persisted binding")
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

type EndpointManifestSigner interface {
	SignEndpointManifest(
		ctx context.Context,
		manifest *chat.FederatedEndpointManifest,
	) error
}

type LocalEndpointManifestVerifier interface {
	VerifyLocalEndpointManifest(
		ctx context.Context,
		manifest *chat.FederatedEndpointManifest,
		expectedHomeStationID string,
		now time.Time,
	) error
}

type LocalEndpointManifestVerifyFunc func(
	ctx context.Context,
	manifest *chat.FederatedEndpointManifest,
	expectedHomeStationID string,
	now time.Time,
) error

func (fn LocalEndpointManifestVerifyFunc) VerifyLocalEndpointManifest(
	ctx context.Context,
	manifest *chat.FederatedEndpointManifest,
	expectedHomeStationID string,
	now time.Time,
) error {
	return fn(ctx, manifest, expectedHomeStationID, now)
}

type EndpointManifestResolver interface {
	ResolveEndpointManifest(
		ctx context.Context,
		actorPTID string,
	) (*chat.FederatedEndpointManifest, error)
}

type EndpointManifestResolveFunc func(
	ctx context.Context,
	actorPTID string,
) (*chat.FederatedEndpointManifest, error)

func (fn EndpointManifestResolveFunc) ResolveEndpointManifest(
	ctx context.Context,
	actorPTID string,
) (*chat.FederatedEndpointManifest, error) {
	return fn(ctx, actorPTID)
}

type RemoteEndpointManifestFetcher interface {
	FetchEndpointManifest(
		ctx context.Context,
		homeStationID string,
		actorPTID string,
	) (*chat.FederatedEndpointManifest, error)
}

type FederationPeerTrustResolver interface {
	EnsurePeerTrust(
		ctx context.Context,
		homeStationID string,
		actorPTID string,
	) error
}

type FederationPeerTrustResolveFunc func(
	ctx context.Context,
	homeStationID string,
	actorPTID string,
) error

func (fn FederationPeerTrustResolveFunc) EnsurePeerTrust(
	ctx context.Context,
	homeStationID string,
	actorPTID string,
) error {
	return fn(ctx, homeStationID, actorPTID)
}

type RemoteMlsKeyPackageClaimer interface {
	ClaimMlsKeyPackage(
		ctx context.Context,
		homeStationID string,
		request *chat.ClaimFederatedMlsKeyPackageRequest,
	) (*chat.ClaimFederatedMlsKeyPackageResponse, error)
}

type FederatedMlsKeyPackageClaimRepository interface {
	ClaimIrreversibly(
		ctx context.Context,
		request *chat.ClaimFederatedMlsKeyPackageRequest,
		homeStationID string,
		claimedAt time.Time,
	) (*chat.ClaimFederatedMlsKeyPackageResponse, error)
}

type EndpointManifestRepository interface {
	BuildLocalManifestSnapshot(
		ctx context.Context,
		actorPTID string,
		homeStationID string,
		now time.Time,
	) (*chat.FederatedEndpointManifest, error)
	SaveVerifiedManifest(
		ctx context.Context,
		manifest *chat.FederatedEndpointManifest,
		manifestBytes []byte,
		manifestSHA256 []byte,
	) error
	ListVerifiedManifests(
		ctx context.Context,
		actorPTIDs []string,
		now time.Time,
	) ([]*chat.FederatedEndpointManifest, error)
	HomeStationForEndpoint(
		ctx context.Context,
		endpoint *chat.CryptoEndpoint,
		now time.Time,
	) (string, error)
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
	MatchFederationFrame(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
	) (bool, error)
	IngestFederationFrame(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
		receivedAt time.Time,
		fn func(queue QueueRepository) error,
	) (duplicate bool, err error)
}
