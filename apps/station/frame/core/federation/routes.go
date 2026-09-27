package federation

import (
	"context"
	"errors"
	"net/http"

	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const (
	// DeliveryRoute is the sole domain-neutral Federation delivery endpoint.
	DeliveryRoute = "/federation/delivery"
	// ActorEndpointManifestRoute serves Actor-owned endpoint routing truth.
	ActorEndpointManifestRoute = "/federation/actor/endpoint-manifest"
	// PresenceQueryRoute serves Home Station-owned presence snapshots.
	PresenceQueryRoute = "/federation/presence/query"
	// ConversationCommandPrepareRoute prepares a command at its authority.
	ConversationCommandPrepareRoute = "/federation/conversation/command/prepare"
	// ConversationLeaveIntentSubmitRoute submits a signed leave intent.
	ConversationLeaveIntentSubmitRoute = "/federation/conversation/mls/leave-intent"
	// ConversationLeaveIntentListRoute lists pending leave intents.
	ConversationLeaveIntentListRoute = "/federation/conversation/mls/leave-intents"
	// ConversationFollowerEventsRoute is the MP-D29 signed replay endpoint.
	ConversationFollowerEventsRoute = "/federation/conversation/follower/events"
	// ConversationEventSyncRoute is the bounded authority catch-up endpoint.
	ConversationEventSyncRoute = "/federation/conversation/events/sync"
	// ConversationAttachmentObjectRoute streams one encrypted object.
	ConversationAttachmentObjectRoute = "/federation/conversation/attachments/objects/:object_id"
	// ConversationAttachmentUploadStatusRoute reads an upload checkpoint.
	ConversationAttachmentUploadStatusRoute = "/federation/conversation/attachments/uploads/:upload_id"
	// ConversationAttachmentUploadBeginRoute begins an encrypted upload.
	ConversationAttachmentUploadBeginRoute = "/federation/conversation/attachments/uploads:begin"
	// ConversationAttachmentChunkRoute writes one ciphertext chunk.
	ConversationAttachmentChunkRoute = "/federation/conversation/attachments/uploads/:upload_id/chunks/:chunk_index"
	// ConversationAttachmentCompleteRoute finalizes an encrypted upload.
	ConversationAttachmentCompleteRoute = "/federation/conversation/attachments/uploads/:upload_id/complete"
	// ConversationAttachmentCancelRoute cancels an encrypted upload.
	ConversationAttachmentCancelRoute = "/federation/conversation/attachments/uploads/:upload_id/cancel"
	// KeyExchangeDirectFetchRoute serves a destructive Direct bundle read.
	KeyExchangeDirectFetchRoute = "/federation/key-exchange/keys/bundle/fetch"
	// KeyExchangeMLSFetchRoute serves a destructive MLS KeyPackage read.
	KeyExchangeMLSFetchRoute = "/federation/key-exchange/mls/key-package/fetch"
	// KeyExchangeMLSClaimRoute irreversibly claims a prepared MLS KeyPackage.
	KeyExchangeMLSClaimRoute = "/federation/key-exchange/mls-key-package/claim"
	// RealtimeSignalRoute forwards a realtime call signal to a recipient's Home Station.
	RealtimeSignalRoute = "/federation/realtime/signal"
	// RealtimeCallResolutionRoute reads call truth from the callee Home Station.
	RealtimeCallResolutionRoute = "/federation/realtime/call-resolution"
	// GroupCallAuthorityJoinRoute requests a LiveKit grant from Conversation Authority.
	GroupCallAuthorityJoinRoute = "/federation/realtime/group-call/join"
)

// PeerRoute identifies one Federation-owned peer HTTP capability.
type PeerRoute string

const (
	PeerRouteActorEndpointManifest          PeerRoute = "actor-endpoint-manifest"
	PeerRoutePresenceQuery                  PeerRoute = "presence-query"
	PeerRouteConversationCommandPrepare     PeerRoute = "conversation-command-prepare"
	PeerRouteConversationLeaveIntentSubmit  PeerRoute = "conversation-leave-intent-submit"
	PeerRouteConversationLeaveIntentList    PeerRoute = "conversation-leave-intent-list"
	PeerRouteConversationFollowerEvents     PeerRoute = "conversation-follower-events"
	PeerRouteConversationEventSync          PeerRoute = "conversation-event-sync"
	PeerRouteConversationAttachmentObject   PeerRoute = "conversation-attachment-object"
	PeerRouteConversationAttachmentStatus   PeerRoute = "conversation-attachment-status"
	PeerRouteConversationAttachmentBegin    PeerRoute = "conversation-attachment-begin"
	PeerRouteConversationAttachmentChunk    PeerRoute = "conversation-attachment-chunk"
	PeerRouteConversationAttachmentComplete PeerRoute = "conversation-attachment-complete"
	PeerRouteConversationAttachmentCancel   PeerRoute = "conversation-attachment-cancel"
	PeerRouteKeyExchangeDirectFetch         PeerRoute = "key-exchange-direct-fetch"
	PeerRouteKeyExchangeMLSFetch            PeerRoute = "key-exchange-mls-fetch"
	PeerRouteKeyExchangeMLSClaim            PeerRoute = "key-exchange-mls-claim"
	PeerRouteRealtimeSignal                 PeerRoute = "realtime-signal"
	PeerRouteRealtimeCallResolution         PeerRoute = "realtime-call-resolution"
	PeerRouteGroupCallAuthorityJoin         PeerRoute = "group-call-authority-join"
)

// PeerEndpointResolver resolves a resource-owner endpoint lazily at request
// time. Federation retains route and authentication ownership.
type PeerEndpointResolver func(PeerRoute) (server.EndpointHandler, error)

// PeerRouteFactoryConfig binds canonical peer routes to their runtime services.
type PeerRouteFactoryConfig struct {
	LocalStationPeerID string
	PeerKeys           authfed.PeerKeyStore
	DeliveryReceiver   delivery.FrameReceiver
	EndpointResolver   PeerEndpointResolver
}

// PeerRouteFactory registers all canonical Station-to-Station routes.
type PeerRouteFactory struct {
	localStationPeerID string
	deliveryReceiver   delivery.FrameReceiver
	endpointResolver   PeerEndpointResolver
	wrappers           map[PeerRoute]server.Wrapper
	deliveryWrapper    server.Wrapper
}

type peerRouteSpec struct {
	id     PeerRoute
	name   string
	path   string
	method server.Method
	scope  string
}

var peerRouteSpecs = []peerRouteSpec{
	{PeerRouteActorEndpointManifest, "federation-actor-endpoint-manifest", ActorEndpointManifestRoute, server.POST, ActorEndpointManifestScope},
	{PeerRoutePresenceQuery, "federation-presence-query", PresenceQueryRoute, server.POST, PresenceQueryScope},
	{PeerRouteConversationCommandPrepare, "federation-conversation-command-prepare", ConversationCommandPrepareRoute, server.POST, ConversationCommandPrepareScope},
	{PeerRouteConversationLeaveIntentSubmit, "federation-conversation-leave-intent-submit", ConversationLeaveIntentSubmitRoute, server.POST, ConversationLeaveIntentScope},
	{PeerRouteConversationLeaveIntentList, "federation-conversation-leave-intent-list", ConversationLeaveIntentListRoute, server.POST, ConversationLeaveIntentScope},
	{PeerRouteConversationFollowerEvents, "federation-conversation-follower-events", ConversationFollowerEventsRoute, server.POST, ConversationFollowerEventsScope},
	{PeerRouteConversationEventSync, "federation-conversation-event-sync", ConversationEventSyncRoute, server.POST, ConversationEventSyncScope},
	{PeerRouteConversationAttachmentObject, "federation-conversation-attachment-object", ConversationAttachmentObjectRoute, server.GET, ConversationAttachmentScope},
	{PeerRouteConversationAttachmentStatus, "federation-conversation-attachment-status", ConversationAttachmentUploadStatusRoute, server.GET, ConversationAttachmentScope},
	{PeerRouteConversationAttachmentBegin, "federation-conversation-attachment-begin", ConversationAttachmentUploadBeginRoute, server.POST, ConversationAttachmentScope},
	{PeerRouteConversationAttachmentChunk, "federation-conversation-attachment-chunk", ConversationAttachmentChunkRoute, server.PUT, ConversationAttachmentScope},
	{PeerRouteConversationAttachmentComplete, "federation-conversation-attachment-complete", ConversationAttachmentCompleteRoute, server.POST, ConversationAttachmentScope},
	{PeerRouteConversationAttachmentCancel, "federation-conversation-attachment-cancel", ConversationAttachmentCancelRoute, server.POST, ConversationAttachmentScope},
	{PeerRouteKeyExchangeDirectFetch, "federation-key-exchange-direct-fetch", KeyExchangeDirectFetchRoute, server.POST, KeyExchangeDirectFetchScope},
	{PeerRouteKeyExchangeMLSFetch, "federation-key-exchange-mls-fetch", KeyExchangeMLSFetchRoute, server.POST, KeyExchangeMLSFetchScope},
	{PeerRouteKeyExchangeMLSClaim, "federation-key-exchange-mls-claim", KeyExchangeMLSClaimRoute, server.POST, KeyExchangeMLSClaimScope},
	{PeerRouteRealtimeSignal, "federation-realtime-signal", RealtimeSignalRoute, server.POST, RealtimeSignalScope},
	{PeerRouteRealtimeCallResolution, "federation-realtime-call-resolution", RealtimeCallResolutionRoute, server.POST, RealtimeCallResolutionScope},
	{PeerRouteGroupCallAuthorityJoin, "federation-group-call-authority-join", GroupCallAuthorityJoinRoute, server.POST, GroupCallAuthorityJoinScope},
}

// NewPeerRouteFactory validates and creates the Federation route owner.
func NewPeerRouteFactory(
	config PeerRouteFactoryConfig,
) (*PeerRouteFactory, error) {
	if config.LocalStationPeerID == "" ||
		config.PeerKeys == nil ||
		config.DeliveryReceiver == nil ||
		config.EndpointResolver == nil {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Federation peer routes",
			errors.New("route dependencies are incomplete"),
		)
	}
	audience := httpadapter.StaticAudience(config.LocalStationPeerID)
	deliveryWrapper := server.HTTPWrapperAdapter(
		httpadapter.RequireFederationToken(
			DeliveryScope,
			config.PeerKeys,
			audience,
			false,
		),
	)
	wrappers := make(map[PeerRoute]server.Wrapper, len(peerRouteSpecs))
	for _, spec := range peerRouteSpecs {
		wrappers[spec.id] = server.HTTPWrapperAdapter(
			httpadapter.RequireFederationToken(
				spec.scope,
				config.PeerKeys,
				audience,
				false,
			),
		)
	}

	return &PeerRouteFactory{
		localStationPeerID: config.LocalStationPeerID,
		deliveryReceiver:   config.DeliveryReceiver,
		endpointResolver:   config.EndpointResolver,
		wrappers:           wrappers,
		deliveryWrapper:    deliveryWrapper,
	}, nil
}

// Handlers returns the canonical Station-to-Station Federation routes.
func (f *PeerRouteFactory) Handlers() []server.Handler {
	return []server.Handler{
		server.NewTypedHandler(
			"federation-delivery",
			DeliveryRoute,
			server.POST,
			f.deliver,
			f.deliveryWrapper,
		),
		server.NewSimpleHandler(
			"federation-actor-endpoint-manifest",
			ActorEndpointManifestRoute,
			server.POST,
			f.dispatchRoute(PeerRouteActorEndpointManifest),
			f.wrappers[PeerRouteActorEndpointManifest],
		),
		server.NewSimpleHandler(
			"federation-presence-query",
			PresenceQueryRoute,
			server.POST,
			f.dispatchRoute(PeerRoutePresenceQuery),
			f.wrappers[PeerRoutePresenceQuery],
		),
		server.NewSimpleHandler(
			"federation-conversation-command-prepare",
			ConversationCommandPrepareRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationCommandPrepare),
			f.wrappers[PeerRouteConversationCommandPrepare],
		),
		server.NewSimpleHandler(
			"federation-conversation-leave-intent-submit",
			ConversationLeaveIntentSubmitRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationLeaveIntentSubmit),
			f.wrappers[PeerRouteConversationLeaveIntentSubmit],
		),
		server.NewSimpleHandler(
			"federation-conversation-leave-intent-list",
			ConversationLeaveIntentListRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationLeaveIntentList),
			f.wrappers[PeerRouteConversationLeaveIntentList],
		),
		server.NewSimpleHandler(
			"federation-conversation-follower-events",
			ConversationFollowerEventsRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationFollowerEvents),
			f.wrappers[PeerRouteConversationFollowerEvents],
		),
		server.NewSimpleHandler(
			"federation-conversation-event-sync",
			ConversationEventSyncRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationEventSync),
			f.wrappers[PeerRouteConversationEventSync],
		),
		server.NewSimpleHandler(
			"federation-conversation-attachment-object",
			ConversationAttachmentObjectRoute,
			server.GET,
			f.dispatchRoute(PeerRouteConversationAttachmentObject),
			f.wrappers[PeerRouteConversationAttachmentObject],
		),
		server.NewSimpleHandler(
			"federation-conversation-attachment-status",
			ConversationAttachmentUploadStatusRoute,
			server.GET,
			f.dispatchRoute(PeerRouteConversationAttachmentStatus),
			f.wrappers[PeerRouteConversationAttachmentStatus],
		),
		server.NewSimpleHandler(
			"federation-conversation-attachment-begin",
			ConversationAttachmentUploadBeginRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationAttachmentBegin),
			f.wrappers[PeerRouteConversationAttachmentBegin],
		),
		server.NewSimpleHandler(
			"federation-conversation-attachment-chunk",
			ConversationAttachmentChunkRoute,
			server.PUT,
			f.dispatchRoute(PeerRouteConversationAttachmentChunk),
			f.wrappers[PeerRouteConversationAttachmentChunk],
		),
		server.NewSimpleHandler(
			"federation-conversation-attachment-complete",
			ConversationAttachmentCompleteRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationAttachmentComplete),
			f.wrappers[PeerRouteConversationAttachmentComplete],
		),
		server.NewSimpleHandler(
			"federation-conversation-attachment-cancel",
			ConversationAttachmentCancelRoute,
			server.POST,
			f.dispatchRoute(PeerRouteConversationAttachmentCancel),
			f.wrappers[PeerRouteConversationAttachmentCancel],
		),
		server.NewSimpleHandler(
			"federation-key-exchange-direct-fetch",
			KeyExchangeDirectFetchRoute,
			server.POST,
			f.dispatchRoute(PeerRouteKeyExchangeDirectFetch),
			f.wrappers[PeerRouteKeyExchangeDirectFetch],
		),
		server.NewSimpleHandler(
			"federation-key-exchange-mls-fetch",
			KeyExchangeMLSFetchRoute,
			server.POST,
			f.dispatchRoute(PeerRouteKeyExchangeMLSFetch),
			f.wrappers[PeerRouteKeyExchangeMLSFetch],
		),
		server.NewSimpleHandler(
			"federation-key-exchange-mls-claim",
			KeyExchangeMLSClaimRoute,
			server.POST,
			f.dispatchRoute(PeerRouteKeyExchangeMLSClaim),
			f.wrappers[PeerRouteKeyExchangeMLSClaim],
		),
		server.NewSimpleHandler(
			"federation-realtime-signal",
			RealtimeSignalRoute,
			server.POST,
			f.dispatchRoute(PeerRouteRealtimeSignal),
			f.wrappers[PeerRouteRealtimeSignal],
		),
		server.NewSimpleHandler(
			"federation-realtime-call-resolution",
			RealtimeCallResolutionRoute,
			server.POST,
			f.dispatchRoute(PeerRouteRealtimeCallResolution),
			f.wrappers[PeerRouteRealtimeCallResolution],
		),
		server.NewSimpleHandler(
			"federation-group-call-authority-join",
			GroupCallAuthorityJoinRoute,
			server.POST,
			f.dispatchRoute(PeerRouteGroupCallAuthorityJoin),
			f.wrappers[PeerRouteGroupCallAuthorityJoin],
		),
	}
}

func (f *PeerRouteFactory) dispatchRoute(
	route PeerRoute,
) server.TypedHandlerFunc {
	return func(
		ctx context.Context,
		request server.Request,
		response server.Response,
	) error {
		return f.dispatch(ctx, route, request, response)
	}
}

func (f *PeerRouteFactory) deliver(
	ctx context.Context,
	request *federationmodel.DeliverFederatedDomainFrameRequest,
) (*federationmodel.DeliverFederatedDomainFrameResponse, error) {
	if request == nil || request.GetFrame() == nil {
		return nil, server.BadRequest("Federation frame is required")
	}
	frame := request.GetFrame()
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil {
		return nil, server.Unauthorized("authenticated Federation peer is required")
	}
	if claims.Scope != DeliveryScope ||
		claims.Issuer != frame.GetSourceStationPeerId() ||
		claims.Subject != frame.GetSourceStationPeerId() ||
		claims.Audience != f.localStationPeerID ||
		frame.GetTargetStationPeerId() != f.localStationPeerID ||
		claims.Custom[ClaimFrameID] != frame.GetFrameId() ||
		claims.Custom[ClaimIdempotencyKey] != frame.GetIdempotencyKey() ||
		claims.Custom[ClaimSourceStationPeerID] != frame.GetSourceStationPeerId() ||
		claims.Custom[ClaimTargetStationPeerID] != frame.GetTargetStationPeerId() {
		return nil, server.Forbidden(
			"Federation delivery authentication binding mismatch",
		)
	}

	result, err := f.deliveryReceiver.Receive(ctx, frame)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"Federation delivery failed",
			err,
		)
	}

	return &federationmodel.DeliverFederatedDomainFrameResponse{
		Disposition: result.Disposition,
		ErrorCode:   result.ErrorCode,
	}, nil
}

func (f *PeerRouteFactory) dispatch(
	ctx context.Context,
	route PeerRoute,
	request server.Request,
	response server.Response,
) error {
	endpoint, err := f.endpointResolver(route)
	if err != nil {
		return server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			"Federation peer capability is unavailable",
			err,
		)
	}
	if endpoint == nil {
		return server.NewHandlerError(
			http.StatusServiceUnavailable,
			"Federation peer capability is unavailable",
		)
	}

	return endpoint(ctx, request, response)
}
