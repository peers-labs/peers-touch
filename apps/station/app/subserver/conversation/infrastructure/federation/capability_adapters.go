package federation

import (
	"context"
	"fmt"
	"io"
	"strings"

	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// CapabilityAdapterConfig binds canonical resource-owner services without
// registering routes or retaining a second Conversation implementation.
type CapabilityAdapterConfig struct {
	LocalStationPeerID string
	EndpointManifests  EndpointManifestPort
	MLSKeyPackages     MLSKeyPackageClaimPort
	LeaveIntents       LeaveIntentPort
	EventSync          EventSyncPort
	Attachments        AttachmentDataPlanePort
}

// CapabilityAdapter authenticates peer-owned wrapper fields before delegating
// to the canonical Actor Identity, Key Exchange, Conversation, and Attachment
// owner services.
type CapabilityAdapter struct {
	localStationPeerID string
	endpointManifests  EndpointManifestPort
	mlsKeyPackages     MLSKeyPackageClaimPort
	leaveIntents       LeaveIntentPort
	eventSync          EventSyncPort
	attachments        AttachmentDataPlanePort
}

// NewCapabilityAdapter creates the non-registering peer capability boundary.
func NewCapabilityAdapter(config CapabilityAdapterConfig) (*CapabilityAdapter, error) {
	if strings.TrimSpace(config.LocalStationPeerID) == "" ||
		config.LocalStationPeerID != strings.TrimSpace(config.LocalStationPeerID) ||
		config.EndpointManifests == nil ||
		config.MLSKeyPackages == nil ||
		config.LeaveIntents == nil ||
		config.EventSync == nil ||
		config.Attachments == nil {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"create Conversation Federation capability adapter",
			fmt.Errorf("local Station and all canonical owner services are required"),
		)
	}
	return &CapabilityAdapter{
		localStationPeerID: config.LocalStationPeerID,
		endpointManifests:  config.EndpointManifests,
		mlsKeyPackages:     config.MLSKeyPackages,
		leaveIntents:       config.LeaveIntents,
		eventSync:          config.EventSync,
		attachments:        config.Attachments,
	}, nil
}

// GetEndpointManifest delegates only a complete canonical Actor lookup.
func (a *CapabilityAdapter) GetEndpointManifest(
	ctx context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	if err := validateAuthenticatedSource(sourceStationPeerID); err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetActor() == nil ||
		request.GetActor().GetPtid() == "" ||
		request.GetActor().GetKind() == actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return nil, invalidCapabilityRequest("endpoint manifest")
	}
	return a.endpointManifests.GetEndpointManifest(
		ctx,
		sourceStationPeerID,
		proto.Clone(request).(*actormodel.GetActorEndpointManifestRequest),
	)
}

// ClaimMLSKeyPackage binds the signed peer identity to the authority named by
// the canonical Key Exchange request.
func (a *CapabilityAdapter) ClaimMLSKeyPackage(
	ctx context.Context,
	sourceAuthorityStationPeerID string,
	request *keyexchangemodel.ClaimMlsKeyPackageRequest,
) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error) {
	if err := validateAuthenticatedSource(sourceAuthorityStationPeerID); err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetAuthorityPlanId() == "" ||
		request.GetAuthorityStationPeerId() != sourceAuthorityStationPeerID ||
		request.GetTarget() == nil ||
		request.GetTarget().GetActor() == nil ||
		request.GetTarget().GetActor().GetPtid() == "" ||
		request.GetTarget().GetDeviceId() == "" ||
		request.GetPlanExpiresAt() == nil ||
		!request.GetPlanExpiresAt().IsValid() {
		return nil, invalidCapabilityRequest("MLS KeyPackage claim")
	}
	return a.mlsKeyPackages.ClaimMLSKeyPackage(
		ctx,
		sourceAuthorityStationPeerID,
		proto.Clone(request).(*keyexchangemodel.ClaimMlsKeyPackageRequest),
	)
}

// SubmitLeaveIntent binds the authenticated Home Station to every canonical
// source and target field before invoking Conversation authority.
func (a *CapabilityAdapter) SubmitLeaveIntent(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.SubmitFederatedMlsLeaveIntentRequest,
) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error) {
	if err := validateAuthenticatedSource(sourceHomeStationPeerID); err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetIntent() == nil ||
		request.GetSourceHomeStationPeerId() != sourceHomeStationPeerID ||
		request.GetIntent().GetHomeStationPeerId() != sourceHomeStationPeerID ||
		request.GetIntent().GetAuthorityStationPeerId() != a.localStationPeerID {
		return nil, invalidCapabilityRequest("submit MLS leave intent")
	}
	return a.leaveIntents.SubmitLeaveIntent(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.SubmitFederatedMlsLeaveIntentRequest),
	)
}

// ListLeaveIntents binds the authenticated Home Station before querying the
// canonical Conversation leave-intent owner.
func (a *CapabilityAdapter) ListLeaveIntents(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.ListFederatedMlsLeaveIntentsRequest,
) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error) {
	if err := validateAuthenticatedSource(sourceHomeStationPeerID); err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetConversationId() == "" ||
		request.GetSourceHomeStationPeerId() != sourceHomeStationPeerID {
		return nil, invalidCapabilityRequest("list MLS leave intents")
	}
	return a.leaveIntents.ListLeaveIntents(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.ListFederatedMlsLeaveIntentsRequest),
	)
}

// SyncAuthorityEvents accepts only a bounded, authority-local canonical query.
func (a *CapabilityAdapter) SyncAuthorityEvents(
	ctx context.Context,
	sourceFollowerStationPeerID string,
	request *chatmodel.SyncAuthorityConversationEventsRequest,
) (*chatmodel.SyncAuthorityConversationEventsResponse, error) {
	if err := validateAuthenticatedSource(sourceFollowerStationPeerID); err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetFederationId() == "" ||
		request.GetConversationId() == "" ||
		request.GetAuthorityEpoch() <= 0 ||
		request.GetAfterGroupSeq() < 0 ||
		request.GetLimit() <= 0 {
		return nil, invalidCapabilityRequest("authority event sync")
	}
	return a.eventSync.SyncAuthorityEvents(
		ctx,
		sourceFollowerStationPeerID,
		proto.Clone(request).(*chatmodel.SyncAuthorityConversationEventsRequest),
	)
}

func (a *CapabilityAdapter) GetUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.GetFederatedConversationAttachmentUploadRequest,
) (*chatmodel.GetFederatedConversationAttachmentUploadResponse, error) {
	if err := a.validateAttachmentRequest(
		sourceHomeStationPeerID,
		request.GetSourceHomeStationPeerId(),
		request.GetRequest() != nil &&
			request.GetRequest().GetAuthorityStationId() == a.localStationPeerID,
	); err != nil {
		return nil, err
	}
	return a.attachments.GetUpload(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.GetFederatedConversationAttachmentUploadRequest),
	)
}

func (a *CapabilityAdapter) BeginUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.BeginFederatedConversationAttachmentUploadRequest,
) (*chatmodel.BeginFederatedConversationAttachmentUploadResponse, error) {
	if err := a.validateAttachmentRequest(
		sourceHomeStationPeerID,
		request.GetSourceHomeStationPeerId(),
		request.GetRequest() != nil &&
			request.GetRequest().GetAuthorityStationId() == a.localStationPeerID,
	); err != nil {
		return nil, err
	}
	return a.attachments.BeginUpload(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.BeginFederatedConversationAttachmentUploadRequest),
	)
}

func (a *CapabilityAdapter) PutChunk(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.PutFederatedConversationAttachmentChunkRequest,
	body io.Reader,
) (*chatmodel.PutFederatedConversationAttachmentChunkResponse, error) {
	if err := a.validateAttachmentRequest(
		sourceHomeStationPeerID,
		request.GetSourceHomeStationPeerId(),
		request.GetRequest() != nil &&
			request.GetRequest().GetAuthorityStationId() == a.localStationPeerID &&
			body != nil,
	); err != nil {
		return nil, err
	}
	return a.attachments.PutChunk(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.PutFederatedConversationAttachmentChunkRequest),
		body,
	)
}

func (a *CapabilityAdapter) CompleteUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.CompleteFederatedConversationAttachmentUploadRequest,
) (*chatmodel.CompleteFederatedConversationAttachmentUploadResponse, error) {
	if err := a.validateAttachmentRequest(
		sourceHomeStationPeerID,
		request.GetSourceHomeStationPeerId(),
		request.GetRequest() != nil &&
			request.GetRequest().GetAuthorityStationId() == a.localStationPeerID,
	); err != nil {
		return nil, err
	}
	return a.attachments.CompleteUpload(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.CompleteFederatedConversationAttachmentUploadRequest),
	)
}

func (a *CapabilityAdapter) CancelUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.CancelFederatedConversationAttachmentUploadRequest,
) (*chatmodel.CancelFederatedConversationAttachmentUploadResponse, error) {
	if err := a.validateAttachmentRequest(
		sourceHomeStationPeerID,
		request.GetSourceHomeStationPeerId(),
		request.GetRequest() != nil &&
			request.GetRequest().GetAuthorityStationId() == a.localStationPeerID,
	); err != nil {
		return nil, err
	}
	return a.attachments.CancelUpload(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.CancelFederatedConversationAttachmentUploadRequest),
	)
}

func (a *CapabilityAdapter) GetObject(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.GetFederatedConversationAttachmentObjectRequest,
	startInclusive int64,
	endInclusive int64,
) (*chatmodel.GetFederatedConversationAttachmentObjectResponse, io.ReadCloser, error) {
	if err := a.validateAttachmentRequest(
		sourceHomeStationPeerID,
		request.GetSourceHomeStationPeerId(),
		request.GetRequest() != nil &&
			request.GetRequest().GetAuthorityStationId() == a.localStationPeerID &&
			startInclusive >= 0 &&
			endInclusive >= startInclusive,
	); err != nil {
		return nil, nil, err
	}
	return a.attachments.GetObject(
		ctx,
		sourceHomeStationPeerID,
		proto.Clone(request).(*chatmodel.GetFederatedConversationAttachmentObjectRequest),
		startInclusive,
		endInclusive,
	)
}

func (a *CapabilityAdapter) validateAttachmentRequest(
	sourceHomeStationPeerID string,
	requestSourceHomeStationPeerID string,
	valid bool,
) error {
	if err := validateAuthenticatedSource(sourceHomeStationPeerID); err != nil {
		return err
	}
	if requestSourceHomeStationPeerID != sourceHomeStationPeerID || !valid {
		return invalidCapabilityRequest("attachment data plane")
	}
	return nil
}

// EndpointManifestFunc adapts the canonical Actor endpoint-manifest operation.
type EndpointManifestFunc func(
	context.Context,
	string,
	*actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error)

// GetEndpointManifest delegates without introducing a Conversation-owned cache.
func (f EndpointManifestFunc) GetEndpointManifest(
	ctx context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	if f == nil {
		return nil, missingCapability("endpoint manifest")
	}
	return f(ctx, sourceStationPeerID, request)
}

// MLSKeyPackageClaimFunc adapts the canonical Key Exchange claim operation.
type MLSKeyPackageClaimFunc func(
	context.Context,
	string,
	*keyexchangemodel.ClaimMlsKeyPackageRequest,
) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error)

// ClaimMLSKeyPackage delegates without interpreting opaque KeyPackage bytes.
func (f MLSKeyPackageClaimFunc) ClaimMLSKeyPackage(
	ctx context.Context,
	sourceAuthorityStationPeerID string,
	request *keyexchangemodel.ClaimMlsKeyPackageRequest,
) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error) {
	if f == nil {
		return nil, missingCapability("MLS KeyPackage claim")
	}
	return f(ctx, sourceAuthorityStationPeerID, request)
}

// LeaveIntentFuncs adapts the canonical D-16 submit and list operations.
type LeaveIntentFuncs struct {
	Submit func(
		context.Context,
		string,
		*chatmodel.SubmitFederatedMlsLeaveIntentRequest,
	) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error)
	List func(
		context.Context,
		string,
		*chatmodel.ListFederatedMlsLeaveIntentsRequest,
	) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error)
}

// SubmitLeaveIntent delegates the authenticated source separately from payload fields.
func (f LeaveIntentFuncs) SubmitLeaveIntent(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.SubmitFederatedMlsLeaveIntentRequest,
) (*chatmodel.SubmitFederatedMlsLeaveIntentResponse, error) {
	if f.Submit == nil {
		return nil, missingCapability("submit MLS leave intent")
	}
	return f.Submit(ctx, sourceHomeStationPeerID, request)
}

// ListLeaveIntents delegates the authenticated source separately from payload fields.
func (f LeaveIntentFuncs) ListLeaveIntents(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.ListFederatedMlsLeaveIntentsRequest,
) (*chatmodel.ListFederatedMlsLeaveIntentsResponse, error) {
	if f.List == nil {
		return nil, missingCapability("list MLS leave intents")
	}
	return f.List(ctx, sourceHomeStationPeerID, request)
}

// EventSyncFunc adapts the canonical authority-event sync operation.
type EventSyncFunc func(
	context.Context,
	string,
	*chatmodel.SyncAuthorityConversationEventsRequest,
) (*chatmodel.SyncAuthorityConversationEventsResponse, error)

// SyncAuthorityEvents delegates without creating another follower store.
func (f EventSyncFunc) SyncAuthorityEvents(
	ctx context.Context,
	sourceFollowerStationPeerID string,
	request *chatmodel.SyncAuthorityConversationEventsRequest,
) (*chatmodel.SyncAuthorityConversationEventsResponse, error) {
	if f == nil {
		return nil, missingCapability("authority event sync")
	}
	return f(ctx, sourceFollowerStationPeerID, request)
}

// AttachmentDataPlaneFuncs adapts all canonical federated attachment metadata
// calls while keeping ciphertext bodies as streams.
type AttachmentDataPlaneFuncs struct {
	GetUploadFunc func(
		context.Context,
		string,
		*chatmodel.GetFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.GetFederatedConversationAttachmentUploadResponse, error)
	BeginUploadFunc func(
		context.Context,
		string,
		*chatmodel.BeginFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.BeginFederatedConversationAttachmentUploadResponse, error)
	PutChunkFunc func(
		context.Context,
		string,
		*chatmodel.PutFederatedConversationAttachmentChunkRequest,
		io.Reader,
	) (*chatmodel.PutFederatedConversationAttachmentChunkResponse, error)
	CompleteUploadFunc func(
		context.Context,
		string,
		*chatmodel.CompleteFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.CompleteFederatedConversationAttachmentUploadResponse, error)
	CancelUploadFunc func(
		context.Context,
		string,
		*chatmodel.CancelFederatedConversationAttachmentUploadRequest,
	) (*chatmodel.CancelFederatedConversationAttachmentUploadResponse, error)
	GetObjectFunc func(
		context.Context,
		string,
		*chatmodel.GetFederatedConversationAttachmentObjectRequest,
		int64,
		int64,
	) (*chatmodel.GetFederatedConversationAttachmentObjectResponse, io.ReadCloser, error)
}

func (f AttachmentDataPlaneFuncs) GetUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.GetFederatedConversationAttachmentUploadRequest,
) (*chatmodel.GetFederatedConversationAttachmentUploadResponse, error) {
	if f.GetUploadFunc == nil {
		return nil, missingCapability("get attachment upload")
	}
	return f.GetUploadFunc(ctx, sourceHomeStationPeerID, request)
}

func (f AttachmentDataPlaneFuncs) BeginUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.BeginFederatedConversationAttachmentUploadRequest,
) (*chatmodel.BeginFederatedConversationAttachmentUploadResponse, error) {
	if f.BeginUploadFunc == nil {
		return nil, missingCapability("begin attachment upload")
	}
	return f.BeginUploadFunc(ctx, sourceHomeStationPeerID, request)
}

func (f AttachmentDataPlaneFuncs) PutChunk(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.PutFederatedConversationAttachmentChunkRequest,
	body io.Reader,
) (*chatmodel.PutFederatedConversationAttachmentChunkResponse, error) {
	if f.PutChunkFunc == nil {
		return nil, missingCapability("put attachment chunk")
	}
	return f.PutChunkFunc(ctx, sourceHomeStationPeerID, request, body)
}

func (f AttachmentDataPlaneFuncs) CompleteUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.CompleteFederatedConversationAttachmentUploadRequest,
) (*chatmodel.CompleteFederatedConversationAttachmentUploadResponse, error) {
	if f.CompleteUploadFunc == nil {
		return nil, missingCapability("complete attachment upload")
	}
	return f.CompleteUploadFunc(ctx, sourceHomeStationPeerID, request)
}

func (f AttachmentDataPlaneFuncs) CancelUpload(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.CancelFederatedConversationAttachmentUploadRequest,
) (*chatmodel.CancelFederatedConversationAttachmentUploadResponse, error) {
	if f.CancelUploadFunc == nil {
		return nil, missingCapability("cancel attachment upload")
	}
	return f.CancelUploadFunc(ctx, sourceHomeStationPeerID, request)
}

func (f AttachmentDataPlaneFuncs) GetObject(
	ctx context.Context,
	sourceHomeStationPeerID string,
	request *chatmodel.GetFederatedConversationAttachmentObjectRequest,
	startInclusive int64,
	endInclusive int64,
) (*chatmodel.GetFederatedConversationAttachmentObjectResponse, io.ReadCloser, error) {
	if f.GetObjectFunc == nil {
		return nil, nil, missingCapability("get attachment object")
	}
	return f.GetObjectFunc(
		ctx,
		sourceHomeStationPeerID,
		request,
		startInclusive,
		endInclusive,
	)
}

func missingCapability(capability string) error {
	return federationdelivery.NewError(
		federationdelivery.FailureInvalidArgument,
		"invoke Conversation Federation capability",
		fmt.Errorf("%s adapter is not configured", capability),
	)
}

func invalidCapabilityRequest(capability string) error {
	return federationdelivery.NewError(
		federationdelivery.FailureInvalidFrame,
		"validate Conversation Federation capability",
		fmt.Errorf("%s request is incomplete or conflicts with authenticated Station identity", capability),
	)
}

func validateAuthenticatedSource(sourceStationPeerID string) error {
	if strings.TrimSpace(sourceStationPeerID) == "" ||
		sourceStationPeerID != strings.TrimSpace(sourceStationPeerID) {
		return federationdelivery.NewError(
			federationdelivery.FailureUnauthenticated,
			"validate Conversation Federation capability",
			fmt.Errorf("authenticated source Station is required"),
		)
	}
	return nil
}

var (
	_ EndpointManifestPort    = EndpointManifestFunc(nil)
	_ MLSKeyPackageClaimPort  = MLSKeyPackageClaimFunc(nil)
	_ LeaveIntentPort         = LeaveIntentFuncs{}
	_ EventSyncPort           = EventSyncFunc(nil)
	_ AttachmentDataPlanePort = AttachmentDataPlaneFuncs{}

	_ EndpointManifestPort    = (*CapabilityAdapter)(nil)
	_ MLSKeyPackageClaimPort  = (*CapabilityAdapter)(nil)
	_ LeaveIntentPort         = (*CapabilityAdapter)(nil)
	_ EventSyncPort           = (*CapabilityAdapter)(nil)
	_ AttachmentDataPlanePort = (*CapabilityAdapter)(nil)
)
