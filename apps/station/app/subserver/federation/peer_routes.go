package federation

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange"
	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	presencemodel "github.com/peers-labs/peers-touch/station/frame/touch/model/presence"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	realtimemodel "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

type conversationPeerEndpointProvider interface {
	FederationPeerHandler(
		route federationruntime.PeerRoute,
	) (server.EndpointHandler, error)
}

type groupCallPeerEndpointProvider interface {
	FederationPeerHandler(
		route federationruntime.PeerRoute,
	) (server.EndpointHandler, error)
}

type actorPeerCapabilities interface {
	GetEndpointManifest(
		context.Context,
		string,
		*actormodel.GetActorEndpointManifestRequest,
	) (*actormodel.GetActorEndpointManifestResponse, error)
}

type presencePeerCapabilities interface {
	QueryLocalPresence(
		context.Context,
		[]string,
	) ([]*presencemodel.PresenceStatus, error)
}

type keyExchangePeerCapabilities interface {
	FetchDirectKeyBundlesForPeer(
		context.Context,
		*keyexchangemodel.FetchDirectKeyBundlesRequest,
	) (*keyexchangemodel.FetchDirectKeyBundlesResponse, error)
	FetchMLSKeyPackageForPeer(
		context.Context,
		*keyexchangemodel.FetchMlsKeyPackageRequest,
	) (*keyexchangemodel.FetchMlsKeyPackageResponse, error)
	ClaimMLSKeyPackage(
		context.Context,
		string,
		*keyexchangemodel.ClaimMlsKeyPackageRequest,
	) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error)
}

type realtimePeerCapabilities interface {
	ResolveFederatedCallResolution(
		context.Context,
		string,
		*realtimemodel.GetFederatedCallResolutionRequest,
	) (*realtimemodel.GetFederatedCallResolutionResponse, error)
}

func resolveFederationPeerEndpoint(
	route federationruntime.PeerRoute,
) (server.EndpointHandler, error) {
	switch route {
	case federationruntime.PeerRouteActorEndpointManifest:
		return handleActorEndpointManifest, nil
	case federationruntime.PeerRoutePresenceQuery:
		return handlePresenceQuery, nil
	case federationruntime.PeerRouteKeyExchangeDirectFetch:
		return handleKeyExchangeDirectFetch, nil
	case federationruntime.PeerRouteKeyExchangeMLSFetch:
		return handleKeyExchangeMLSFetch, nil
	case federationruntime.PeerRouteKeyExchangeMLSClaim:
		return handleKeyExchangeMLSClaim, nil
	case federationruntime.PeerRouteRealtimeCallResolution:
		return handleRealtimeCallResolution, nil
	case federationruntime.PeerRouteRealtimeSignal:
		return handleRealtimeSignal, nil
	case federationruntime.PeerRouteGroupCallAuthorityJoin:
		instance := server.GetOptions().SubserverInstances["groupcall"]
		provider, ok := instance.(groupCallPeerEndpointProvider)
		if !ok || provider == nil {
			return nil, fmt.Errorf(
				"group-call peer capability provider is unavailable",
			)
		}
		return provider.FederationPeerHandler(route)
	default:
		instance := server.GetOptions().SubserverInstances["conversation"]
		provider, ok := instance.(conversationPeerEndpointProvider)
		if !ok || provider == nil {
			return nil, fmt.Errorf(
				"canonical Conversation peer capability provider is unavailable",
			)
		}

		return provider.FederationPeerHandler(route)
	}
}

func handleRealtimeCallResolution(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	instance := server.GetOptions().SubserverInstances["events"]
	provider, ok := instance.(realtimePeerCapabilities)
	if !ok || provider == nil {
		return server.NewHandlerError(
			http.StatusServiceUnavailable,
			"Realtime call-resolution capability is unavailable",
		)
	}
	input := &realtimemodel.GetFederatedCallResolutionRequest{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		strings.TrimSpace(input.GetRequestingActorPtid()) == "" ||
		strings.TrimSpace(input.GetPeerActorPtid()) == "" ||
		strings.TrimSpace(input.GetCallId()) == "" ||
		claims.Subject != input.GetRequestingActorPtid() ||
		claims.Custom[federationruntime.ClaimActorPTID] !=
			input.GetRequestingActorPtid() ||
		claims.Custom[federationruntime.ClaimCallID] != input.GetCallId() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the Realtime call-resolution request",
		)
	}
	result, err := provider.ResolveFederatedCallResolution(
		ctx,
		claims.Issuer,
		input,
	)
	if err != nil {
		return err
	}
	return writeFederationPeerResponse(response, result)
}

func handleActorEndpointManifest(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	instance := server.GetOptions().SubserverInstances["actor_identity"]
	provider, ok := instance.(actorPeerCapabilities)
	if !ok || provider == nil {
		return server.NewHandlerError(
			http.StatusServiceUnavailable,
			"Actor endpoint manifest capability is unavailable",
		)
	}
	input := &actormodel.GetActorEndpointManifestRequest{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		input.GetActor() == nil ||
		strings.TrimSpace(input.GetActor().GetPtid()) == "" ||
		claims.Custom[federationruntime.ClaimActorPTID] !=
			input.GetActor().GetPtid() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the Actor endpoint manifest request",
		)
	}
	result, err := provider.GetEndpointManifest(
		ctx,
		claims.Issuer,
		input,
	)
	if err != nil {
		return err
	}

	return writeFederationPeerResponse(response, result)
}

func handlePresenceQuery(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	instance := server.GetOptions().SubserverInstances["presence"]
	provider, ok := instance.(presencePeerCapabilities)
	if !ok || provider == nil {
		return server.NewHandlerError(
			http.StatusServiceUnavailable,
			"Presence peer capability is unavailable",
		)
	}
	input := &presencemodel.PresenceQueryRequest{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	requestSHA256, err := federationruntime.PresenceQueryRequestSHA256(input)
	if err != nil {
		return server.BadRequestWithCause(
			"Federation Presence request is invalid",
			err,
		)
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		strings.TrimSpace(claims.Subject) == "" ||
		claims.Custom[federationruntime.ClaimRequesterPTID] != claims.Subject ||
		claims.Custom[federationruntime.ClaimPresenceRequestSHA256] !=
			requestSHA256 ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the Presence query request",
		)
	}
	statuses, err := provider.QueryLocalPresence(ctx, input.ActorPtids)
	if err != nil {
		return err
	}

	return writeFederationPeerResponse(
		response,
		&presencemodel.PresenceQueryResponse{Statuses: statuses},
	)
}

func handleKeyExchangeDirectFetch(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	provider, err := resolveKeyExchangePeerCapabilities()
	if err != nil {
		return err
	}
	input := &keyexchangemodel.FetchFederatedDirectKeyBundlesRequest{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	nested := input.GetRequest()
	if claims == nil ||
		nested == nil ||
		input.GetSourceHomeStationPeerId() != claims.Issuer {
		return server.Forbidden(
			"Federation claims do not match the Direct key-bundle fetch request",
		)
	}
	if err := key_exchange.ValidateDirectFetchPeerClaims(
		claims,
		nested,
	); err != nil {
		return err
	}
	result, err := provider.FetchDirectKeyBundlesForPeer(ctx, nested)
	if err != nil {
		return err
	}

	return writeFederationPeerResponse(
		response,
		&keyexchangemodel.FetchFederatedDirectKeyBundlesResponse{
			Response: result,
		},
	)
}

func handleKeyExchangeMLSFetch(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	provider, err := resolveKeyExchangePeerCapabilities()
	if err != nil {
		return err
	}
	input := &keyexchangemodel.FetchFederatedMlsKeyPackageRequest{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	nested := input.GetRequest()
	if claims == nil ||
		nested == nil ||
		input.GetSourceHomeStationPeerId() != claims.Issuer {
		return server.Forbidden(
			"Federation claims do not match the MLS KeyPackage fetch request",
		)
	}
	if err := key_exchange.ValidateMLSFetchPeerClaims(
		claims,
		nested,
	); err != nil {
		return err
	}
	result, err := provider.FetchMLSKeyPackageForPeer(ctx, nested)
	if err != nil {
		return err
	}

	return writeFederationPeerResponse(
		response,
		&keyexchangemodel.FetchFederatedMlsKeyPackageResponse{
			Response: result,
		},
	)
}

func handleKeyExchangeMLSClaim(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	provider, err := resolveKeyExchangePeerCapabilities()
	if err != nil {
		return err
	}
	input := &keyexchangemodel.ClaimMlsKeyPackageRequest{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if err := key_exchange.ValidateMLSClaimPeerClaims(claims, input); err != nil {
		return err
	}
	result, err := provider.ClaimMLSKeyPackage(ctx, claims.Issuer, input)
	if err != nil {
		return err
	}

	return writeFederationPeerResponse(response, result)
}

func resolveKeyExchangePeerCapabilities() (
	keyExchangePeerCapabilities,
	error,
) {
	instance := server.GetOptions().SubserverInstances["key_exchange"]
	provider, ok := instance.(keyExchangePeerCapabilities)
	if !ok || provider == nil {
		return nil, server.NewHandlerError(
			http.StatusServiceUnavailable,
			"Key Exchange peer capability is unavailable",
		)
	}

	return provider, nil
}

func decodeFederationPeerRequest(
	request server.Request,
	message proto.Message,
) error {
	if request == nil || message == nil || len(request.Body()) == 0 {
		return server.BadRequest("Federation protobuf request body is required")
	}
	if err := proto.Unmarshal(request.Body(), message); err != nil {
		return server.BadRequestWithCause(
			"Federation protobuf request body is invalid",
			err,
		)
	}
	if len(message.ProtoReflect().GetUnknown()) != 0 {
		return server.BadRequest(
			"Federation protobuf request contains unknown fields",
		)
	}

	return nil
}

func writeFederationPeerResponse(
	response server.Response,
	message proto.Message,
) error {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return server.InternalErrorWithCause(
			"encode Federation protobuf response",
			err,
		)
	}
	response.SetHeader("Content-Type", "application/protobuf")
	response.WriteHeader(http.StatusOK)
	if _, err := response.Write(body); err != nil {
		return fmt.Errorf("write Federation protobuf response: %w", err)
	}

	return nil
}

type realtimeSignalPeerCapabilities interface {
	PublishPeerSignal(context.Context, string, *realtime.CallSignal) error
}

func handleRealtimeSignal(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	instance := server.GetOptions().SubserverInstances["events"]
	provider, ok := instance.(realtimeSignalPeerCapabilities)
	if !ok || provider == nil {
		return server.NewHandlerError(
			http.StatusServiceUnavailable,
			"Realtime signal peer capability is unavailable",
		)
	}
	input := &realtime.CallSignal{}
	if err := decodeFederationPeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	recipientPTID := ""
	if claims != nil {
		recipientPTID = claims.Custom[federationruntime.ClaimRecipientPTID]
	}
	if claims == nil ||
		strings.TrimSpace(input.GetFromActorPtid()) == "" ||
		strings.TrimSpace(recipientPTID) == "" ||
		claims.Custom[federationruntime.ClaimSenderPTID] !=
			input.GetFromActorPtid() ||
		claims.Custom[federationruntime.ClaimSessionULID] !=
			input.GetSessionUlid() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the realtime signal request",
		)
	}
	if err := provider.PublishPeerSignal(ctx, recipientPTID, input); err != nil {
		return err
	}

	return writeFederationPeerResponse(response, &realtime.CallSignal{})
}
