package httpinterface

import (
	"context"
	"errors"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrMlsKeyPackageClaimBinding = errors.New(
	"messaging: authenticated MLS KeyPackage claim binding mismatch",
)

type LocalMlsKeyPackageClaimService interface {
	Claim(
		ctx context.Context,
		request *chat.ClaimFederatedMlsKeyPackageRequest,
	) (*chat.ClaimFederatedMlsKeyPackageResponse, error)
}

type MlsKeyPackageClaimHandler struct {
	service LocalMlsKeyPackageClaimService
}

func NewMlsKeyPackageClaimHandler(
	service LocalMlsKeyPackageClaimService,
) (*MlsKeyPackageClaimHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: MLS KeyPackage claim handler service is required")
	}
	return &MlsKeyPackageClaimHandler{service: service}, nil
}

func (h *MlsKeyPackageClaimHandler) ClaimAuthenticated(
	ctx context.Context,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
) (*chat.ClaimFederatedMlsKeyPackageResponse, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if request == nil || !validMlsKeyPackageClaimClaims(claims, request) {
		return nil, ErrMlsKeyPackageClaimBinding
	}
	return h.service.Claim(ctx, request)
}

func validMlsKeyPackageClaimClaims(
	claims *authfed.VerifiedClaims,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
) bool {
	return claims != nil &&
		request != nil &&
		request.Target != nil &&
		request.AuthorityPlanId != "" &&
		request.AuthorityStationId != "" &&
		request.Target.Ptid != "" &&
		request.Target.DeviceId != "" &&
		request.PlanExpiresAt != nil &&
		claims.Scope == messaging.MlsKeyPackageClaimScope &&
		claims.Issuer == request.AuthorityStationId &&
		claims.Subject == claims.Issuer &&
		claims.Audience != "" &&
		claims.Custom[messaging.FederationClaimAuthorityPlanID] == request.AuthorityPlanId &&
		claims.Custom[messaging.FederationClaimTargetPTID] == request.Target.Ptid &&
		claims.Custom[messaging.FederationClaimTargetDeviceID] == request.Target.DeviceId &&
		claims.Custom[messaging.FederationClaimPlanExpiresAt] ==
			request.PlanExpiresAt.AsTime().UTC().Format(time.RFC3339Nano) &&
		claims.Custom[messaging.FederationClaimSourceStationID] == claims.Issuer &&
		claims.Custom[messaging.FederationClaimTargetStationID] == claims.Audience
}
