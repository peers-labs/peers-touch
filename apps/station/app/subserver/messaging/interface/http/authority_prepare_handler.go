package httpinterface

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrAuthorityPrepareBinding = errors.New(
	"messaging: authenticated authority prepare binding mismatch",
)

type AuthorityPrepareHandler struct {
	authority *application.AuthorityService
	devices   messaging.DeviceDirectory
}

func NewAuthorityPrepareHandler(
	authority *application.AuthorityService,
	devices messaging.DeviceDirectory,
) (*AuthorityPrepareHandler, error) {
	if authority == nil || devices == nil {
		return nil, errors.New("messaging: authority prepare handler dependencies are invalid")
	}
	return &AuthorityPrepareHandler{
		authority: authority,
		devices:   devices,
	}, nil
}

func (h *AuthorityPrepareHandler) PrepareAuthenticated(
	ctx context.Context,
	wrapper *chat.FederatedPrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if wrapper == nil ||
		wrapper.Request == nil ||
		wrapper.Request.Sender == nil ||
		!validAuthorityPrepareClaims(
			claims,
			wrapper.Request.ConversationId,
			wrapper.SourceHomeStationId,
			wrapper.Request.AuthorityStationId,
		) {
		return nil, ErrAuthorityPrepareBinding
	}
	homeStationID, err := h.devices.HomeStationID(ctx, wrapper.Request.Sender)
	if err != nil {
		return nil, err
	}
	if homeStationID != wrapper.SourceHomeStationId {
		return nil, ErrAuthorityPrepareBinding
	}
	return h.authority.PrepareSend(ctx, wrapper.Request)
}

func validAuthorityPrepareClaims(
	claims *authfed.VerifiedClaims,
	conversationID string,
	sourceStationID string,
	targetStationID string,
) bool {
	return claims != nil &&
		conversationID != "" &&
		sourceStationID != "" &&
		targetStationID != "" &&
		claims.Scope == messaging.AuthorityPrepareScope &&
		claims.Issuer == sourceStationID &&
		claims.Subject == claims.Issuer &&
		claims.Audience == targetStationID &&
		claims.Custom[messaging.FederationClaimConversationID] == conversationID &&
		claims.Custom[messaging.FederationClaimSourceStationID] == claims.Issuer &&
		claims.Custom[messaging.FederationClaimTargetStationID] == claims.Audience
}
