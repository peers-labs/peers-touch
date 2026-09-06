package httpinterface

import (
	"context"
	"errors"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrAuthorityPrepareBinding = errors.New(
	"messaging: authenticated authority prepare binding mismatch",
)

// AuthorityPrepareService prepares a command for a sender authenticated by its
// Home Station.
type AuthorityPrepareService interface {
	PrepareFederatedSend(
		ctx context.Context,
		sourceHomeStationID string,
		request *chat.PrepareMessagingSendRequest,
	) (*chat.PrepareMessagingSendResponse, error)
}

type AuthorityPrepareHandler struct {
	authority AuthorityPrepareService
}

func NewAuthorityPrepareHandler(
	authority AuthorityPrepareService,
) (*AuthorityPrepareHandler, error) {
	if authority == nil {
		return nil, errors.New("messaging: authority prepare handler dependencies are invalid")
	}
	return &AuthorityPrepareHandler{
		authority: authority,
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
	return h.authority.PrepareFederatedSend(
		ctx,
		wrapper.SourceHomeStationId,
		wrapper.Request,
	)
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
