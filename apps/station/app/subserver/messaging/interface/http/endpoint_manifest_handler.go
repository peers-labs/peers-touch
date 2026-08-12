package httpinterface

import (
	"context"
	"errors"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrEndpointManifestBinding = errors.New(
	"messaging: authenticated endpoint manifest binding mismatch",
)

type LocalEndpointManifestService interface {
	BuildLocalEndpointManifest(
		ctx context.Context,
		actorPTID string,
	) (*chat.FederatedEndpointManifest, error)
}

type EndpointManifestHandler struct {
	service LocalEndpointManifestService
}

func NewEndpointManifestHandler(
	service LocalEndpointManifestService,
) (*EndpointManifestHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: endpoint manifest handler service is required")
	}
	return &EndpointManifestHandler{service: service}, nil
}

func (h *EndpointManifestHandler) GetAuthenticated(
	ctx context.Context,
	request *chat.GetFederatedEndpointManifestRequest,
) (*chat.GetFederatedEndpointManifestResponse, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if request == nil || !validEndpointManifestClaims(claims, request.ActorPtid) {
		return nil, ErrEndpointManifestBinding
	}
	manifest, err := h.service.BuildLocalEndpointManifest(ctx, request.ActorPtid)
	if err != nil {
		return nil, err
	}
	return &chat.GetFederatedEndpointManifestResponse{Manifest: manifest}, nil
}

func validEndpointManifestClaims(
	claims *authfed.VerifiedClaims,
	actorPTID string,
) bool {
	return claims != nil &&
		actorPTID != "" &&
		claims.Scope == messaging.EndpointManifestScope &&
		claims.Issuer != "" &&
		claims.Subject == claims.Issuer &&
		claims.Audience != "" &&
		claims.Custom[messaging.FederationClaimActorPTID] == actorPTID &&
		claims.Custom[messaging.FederationClaimSourceStationID] == claims.Issuer &&
		claims.Custom[messaging.FederationClaimTargetStationID] == claims.Audience
}
