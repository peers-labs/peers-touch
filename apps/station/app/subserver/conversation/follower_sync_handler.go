package conversation

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	authorityEventSyncScope = "conversation-authority-event-sync"
	syncClaimFederation     = "federation_id"
	syncClaimConversation   = "conversation_id"
	syncClaimAuthorityEpoch = "authority_epoch"
)

var authorityEventSyncScopeOnce sync.Once

func registerAuthorityEventSyncScope() {
	authorityEventSyncScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        authorityEventSyncScope,
			Description: "follower pull of authority conversation events",
			Policy: scope.Policy{
				TTLMax:           60 * time.Second,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					syncClaimFederation,
					syncClaimConversation,
					syncClaimAuthorityEpoch,
				},
			},
		})
	})
}

func authorityEventSyncAudience() httpadapter.AudienceResolver {
	return func(_ *http.Request) (string, error) {
		return conversationLocalAudience(), nil
	}
}

func (s *subServer) handleSyncAuthorityEvents(
	ctx context.Context,
	req *chat.SyncAuthorityConversationEventsRequest,
) (*chat.SyncAuthorityConversationEventsResponse, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil {
		return nil, server.Unauthorized("federation token required")
	}
	if req.FederationId == "" || req.ConversationId == "" || req.AuthorityEpoch <= 0 {
		return nil, server.BadRequest("federation_id, conversation_id, and authority_epoch are required")
	}
	if claims.Custom[syncClaimFederation] != req.FederationId ||
		claims.Custom[syncClaimConversation] != req.ConversationId ||
		claims.Custom[syncClaimAuthorityEpoch] != strconv.FormatInt(req.AuthorityEpoch, 10) {
		return nil, server.Forbidden("authority sync claim mismatch")
	}
	active, err := s.proposalService.federation.IsActiveStation(
		ctx,
		req.FederationId,
		claims.Issuer,
	)
	if err != nil {
		return nil, server.InternalErrorWithCause("resolve follower Federation membership", err)
	}
	if !active {
		return nil, server.Forbidden("follower Station is not active")
	}
	conversation, err := s.service.GetConversation(ctx, req.ConversationId)
	if err != nil {
		return nil, server.InternalErrorWithCause("load authority conversation", err)
	}
	if conversation.AuthorityStationPeerId != s.localStationID ||
		conversation.FederationId != req.FederationId ||
		conversation.AuthorityEpoch != req.AuthorityEpoch {
		return nil, server.Forbidden("conversation authority mismatch")
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 128 {
		limit = 128
	}
	events, err := s.service.ListEvents(ctx, req.ConversationId, req.AfterGroupSeq, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list authority events", err)
	}
	return &chat.SyncAuthorityConversationEventsResponse{Events: events}, nil
}
