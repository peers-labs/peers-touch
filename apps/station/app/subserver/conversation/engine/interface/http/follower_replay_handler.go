package httpinterface

import (
	"context"
	"encoding/hex"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrFollowerReplayBinding = errors.New(
	"messaging: authenticated follower replay binding mismatch",
)

type FollowerReplayPageService interface {
	GetPage(
		ctx context.Context,
		requestingHomeStationID string,
		request *chat.GetMessagingFollowerEventsRequest,
	) (*chat.MessagingFollowerEventsPage, error)
}

type FollowerReplayHandler struct {
	service FollowerReplayPageService
}

func NewFollowerReplayHandler(
	service FollowerReplayPageService,
) (*FollowerReplayHandler, error) {
	if service == nil {
		return nil, errors.New("messaging: follower replay handler dependencies are invalid")
	}
	return &FollowerReplayHandler{service: service}, nil
}

func (h *FollowerReplayHandler) GetAuthenticated(
	ctx context.Context,
	request *chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if !validFollowerReplayClaims(claims, request) {
		return nil, ErrFollowerReplayBinding
	}
	return h.service.GetPage(ctx, claims.Issuer, request)
}

func validFollowerReplayClaims(
	claims *authfed.VerifiedClaims,
	request *chat.GetMessagingFollowerEventsRequest,
) bool {
	if claims == nil ||
		request == nil ||
		claims.Scope != messaging.FollowerReplayScope ||
		claims.Issuer == "" ||
		claims.Subject != claims.Issuer ||
		claims.Audience == "" ||
		request.ConversationId == "" ||
		request.AuthorityStationId != claims.Audience ||
		request.TargetHomeStationId != claims.Issuer ||
		claims.Custom[messaging.FederationClaimConversationID] != request.ConversationId ||
		claims.Custom[messaging.FederationClaimSourceStationID] != claims.Issuer ||
		claims.Custom[messaging.FederationClaimTargetStationID] != claims.Audience {
		return false
	}
	requestHash, err := application.FollowerReplayRequestSHA256(request)
	if err != nil {
		return false
	}
	return claims.Custom[messaging.FederationClaimRequestSHA256] ==
		hex.EncodeToString(requestHash)
}

var _ FollowerReplayPageService = (*application.FollowerReplayService)(nil)
