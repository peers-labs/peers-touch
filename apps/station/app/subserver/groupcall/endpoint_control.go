package groupcall

import (
	"context"
	"errors"
	"fmt"

	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *subServer) mintEndpointGrant(ctx context.Context, g endpointGrant) (*JoinResponse, error) {
	var result *JoinResponse
	err := s.authorityFence.WithGroupCallFence(ctx, g.ConversationID, g.endpoint(), g.Authority, g.AuthorityEpoch, func() error {
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			g.Side = grantAuthority
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&g).Error; err != nil {
				return err
			}
			var current endpointGrant
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("grant_id = ? AND side = ?", g.GrantID, grantAuthority).Take(&current).Error; err != nil {
				return err
			}
			if current.Status != grantIssued || !sameGrant(current, g) {
				return server.Forbidden("group call endpoint grant cannot be reactivated")
			}
			allowed, err := s.checkHome(ctx, current)
			if err != nil {
				return err
			}
			if !allowed {
				return server.Forbidden("group call endpoint is no longer authorized at Home")
			}
			room, err := s.provider.CreateRoom(ctx, g.ConversationID)
			if err != nil {
				return err
			}
			url, token, err := s.provider.GenerateToken(ctx, room, g.identity())
			if err != nil {
				return err
			}
			result = &JoinResponse{URL: url, Token: token, RoomName: room,
				GrantID: g.GrantID, ParticipantIdentity: g.identity()}
			return nil
		})
	})
	return result, err
}

func (s *subServer) endpointPeerCall(ctx context.Context, g endpointGrant, kind realtime.GroupCallEndpointControlKind, target string) (*realtime.GroupCallEndpointControlResponse, error) {
	input := &realtime.GroupCallEndpointControlRequest{Kind: kind, Grant: g.wire()}
	result := &realtime.GroupCallEndpointControlResponse{}
	source := s.federation.LocalStationPeerID()
	err := s.federation.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: target, Route: federationruntime.PeerRouteGroupCallEndpointControl,
		Subject: g.ActorPTID, Request: input, Response: result,
		Claims: map[string]string{
			federationruntime.ClaimActorPTID:              g.ActorPTID,
			federationruntime.ClaimSourceStationPeerID:    source,
			federationruntime.ClaimTargetStationPeerID:    target,
			federationruntime.ClaimCanonicalRequestSHA256: groupRequestDigest(input),
		},
	})
	return result, err
}

func (s *subServer) checkHome(ctx context.Context, g endpointGrant) (bool, error) {
	if g.Home == s.federation.LocalStationPeerID() {
		return s.authorizeHome(ctx, g)
	}
	result, err := s.endpointPeerCall(ctx, g,
		realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_CHECK_HOME, g.Home)
	if err != nil {
		return false, err
	}
	return result.GetAllowed(), nil
}

func (s *subServer) ejectAtAuthority(ctx context.Context, g endpointGrant) error {
	if g.Authority == s.federation.LocalStationPeerID() {
		return s.revokeAuthority(ctx, g)
	}
	result, err := s.endpointPeerCall(ctx, g,
		realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_REVOKE_AUTHORITY, g.Authority)
	if err != nil {
		return err
	}
	if !result.GetEjected() {
		return fmt.Errorf("Authority did not confirm endpoint media ejection")
	}
	return nil
}

func (s *subServer) handleEndpointControl(ctx context.Context, request server.Request, response server.Response) error {
	input := &realtime.GroupCallEndpointControlRequest{}
	if err := decodePeerRequest(request, input); err != nil {
		return err
	}
	if input.GetKind() == realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_ROOM_STATUS ||
		input.GetKind() == realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_DECLINE_INVITATION {
		result, err := s.federatedRoomStatus(ctx, httpadapter.GetVerifiedClaims(ctx), input)
		if err != nil {
			return err
		}
		return writePeerResponse(response, result)
	}
	g, err := grantFromWire(input.GetGrant(), grantAuthority)
	if err != nil {
		return server.Forbidden("invalid endpoint control grant")
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	local := s.federation.LocalStationPeerID()
	if claims == nil || claims.Audience != local || claims.Subject != g.ActorPTID ||
		claims.Custom[federationruntime.ClaimActorPTID] != g.ActorPTID ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != local ||
		claims.Custom[federationruntime.ClaimCanonicalRequestSHA256] != groupRequestDigest(input) {
		return server.Forbidden("endpoint control claims do not match the signed request")
	}
	result := &realtime.GroupCallEndpointControlResponse{}
	switch input.GetKind() {
	case realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_CHECK_HOME:
		if claims.Issuer != g.Authority || local != g.Home {
			return server.Forbidden("only the grant Authority may check its Home endpoint")
		}
		result.Allowed, err = s.authorizeHome(ctx, g)
	case realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_REVOKE_AUTHORITY:
		if claims.Issuer != g.Home || local != g.Authority {
			return server.Forbidden("only the endpoint Home may revoke its Authority grant")
		}
		var current endpointGrant
		loadErr := s.db.WithContext(ctx).Where("grant_id = ? AND side = ?", g.GrantID, grantAuthority).Take(&current).Error
		if loadErr != nil && !errors.Is(loadErr, gorm.ErrRecordNotFound) {
			return loadErr
		}
		if loadErr == nil && !sameGrant(current, g) {
			return server.Forbidden("endpoint grant changed")
		}
		err = s.revokeAuthority(ctx, g)
		result.Ejected = err == nil
	default:
		return server.BadRequest("endpoint control action is required")
	}
	if err != nil {
		return err
	}
	return writePeerResponse(response, result)
}
