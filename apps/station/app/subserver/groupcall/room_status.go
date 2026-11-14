package groupcall

import (
	"context"

	actorpersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/mediaaccess"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type invitationDecision struct {
	ConversationID string `gorm:"primaryKey;size:64"`
	RoomSID        string `gorm:"column:room_sid;primaryKey;size:64"`
	ActorPTID      string `gorm:"column:actor_ptid;primaryKey;size:255"`
}

func (invitationDecision) TableName() string { return "group_call_invitation_decisions" }

// Reconciliation reads the current SFU generation through the caller Home.
// An SSE event can trigger this read but cannot assert current room state.
func (s *subServer) handleRoomStatus(ctx context.Context, req *JoinRequest) (*RoomStatus, error) {
	return s.homeRoomQuery(ctx, req, "", "")
}

func (s *subServer) handleDeclineInvitation(ctx context.Context, req *DeclineInvitationRequest) (*RoomStatus, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || req == nil || req.RoomSID == "" {
		return nil, server.BadRequest("authenticated invitation and room_sid required")
	}
	owner, err := currentMediaSessionOwner()
	if err != nil {
		return nil, err
	}
	var result *RoomStatus
	err = owner.WithMediaSessionFence(ctx, subject.SessionID, subject.ID, s.federation.LocalStationPeerID(),
		func(tx *gorm.DB, binding session.MediaSession) error {
			if err := actorpersistence.RequireActiveDeviceForMutation(tx,
				actorpersistence.DeviceLocator{PTID: subject.ID, DeviceID: binding.DeviceID}); err != nil {
				return err
			}
			result, err = s.homeRoomQuery(ctx, &JoinRequest{GroupULID: req.GroupULID}, req.RoomSID, binding.DeviceID)
			return err
		})
	return result, err
}

func (s *subServer) homeRoomQuery(ctx context.Context, req *JoinRequest, declinedSID, deviceID string) (*RoomStatus, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || subject.SessionID == "" {
		return nil, server.Unauthorized("authenticated session required")
	}
	if req == nil || req.GroupULID == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	authority, federation, epoch, home, member, err := s.authority.ResolveGroupCallAuthority(ctx, req.GroupULID, subject.ID)
	if err != nil {
		return nil, err
	}
	local := s.federation.LocalStationPeerID()
	if !member || home != local {
		return nil, server.Forbidden("active group Home membership required")
	}
	kind := realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_ROOM_STATUS
	if declinedSID != "" {
		kind = realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_DECLINE_INVITATION
	}
	input := &realtime.GroupCallEndpointControlRequest{
		Kind: kind, RoomSid: declinedSID,
		RoomQuery: &realtime.GroupCallAuthorityJoinRequest{
			ConversationId: req.GroupULID, ActorPtid: subject.ID, SourceHomeStationPeerId: home,
			FederationId: federation, AuthorityEpoch: epoch, ActorDeviceId: deviceID,
		},
	}
	if authority == local {
		return s.authorityRoomQuery(ctx, input)
	}
	result := &realtime.GroupCallEndpointControlResponse{}
	err = s.federation.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: authority, Route: federationruntime.PeerRouteGroupCallEndpointControl,
		Subject: subject.ID, Request: input, Response: result,
		Claims: map[string]string{
			federationruntime.ClaimActorPTID:              subject.ID,
			federationruntime.ClaimSourceStationPeerID:    home,
			federationruntime.ClaimTargetStationPeerID:    authority,
			federationruntime.ClaimCanonicalRequestSHA256: groupRequestDigest(input),
		},
	})
	if err != nil {
		return nil, err
	}
	if result.GetRoomName() != "" && result.GetRoomName() != roomName(req.GroupULID) {
		return nil, server.InternalError("Authority returned a different group call room")
	}
	return &RoomStatus{Active: result.GetRoomActive(), RoomName: result.GetRoomName(), RoomSID: result.GetRoomSid(),
		DeclinedActorPTIDs: result.GetDeclinedActorPtids()}, nil
}

func (s *subServer) federatedRoomStatus(ctx context.Context, claims *authfed.VerifiedClaims,
	input *realtime.GroupCallEndpointControlRequest) (*realtime.GroupCallEndpointControlResponse, error) {
	query := input.GetRoomQuery()
	local := s.federation.LocalStationPeerID()
	if claims == nil || query == nil || claims.Audience != local || claims.Subject != query.GetActorPtid() ||
		claims.Issuer != query.GetSourceHomeStationPeerId() ||
		claims.Custom[federationruntime.ClaimActorPTID] != query.GetActorPtid() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != local ||
		claims.Custom[federationruntime.ClaimCanonicalRequestSHA256] != groupRequestDigest(input) {
		return nil, server.Forbidden("room query claims do not match")
	}
	status, err := s.authorityRoomQuery(ctx, input)
	if err != nil {
		return nil, err
	}
	return &realtime.GroupCallEndpointControlResponse{
		RoomActive: status.Active, RoomName: status.RoomName, RoomSid: status.RoomSID,
		DeclinedActorPtids: status.DeclinedActorPTIDs,
	}, nil
}

func (s *subServer) authorityRoomQuery(ctx context.Context, input *realtime.GroupCallEndpointControlRequest) (*RoomStatus, error) {
	query := input.GetRoomQuery()
	if query == nil {
		return nil, server.BadRequest("room query required")
	}
	local := s.federation.LocalStationPeerID()
	authority, federation, epoch, home, member, err := s.authority.ResolveGroupCallAuthority(ctx, query.GetConversationId(), query.GetActorPtid())
	if err != nil {
		return nil, err
	}
	if !member || authority != local || home != query.GetSourceHomeStationPeerId() ||
		federation != query.GetFederationId() || epoch != query.GetAuthorityEpoch() {
		return nil, server.Forbidden("room query no longer matches group authority")
	}
	var status *RoomStatus
	read := func() error {
		var err error
		status, err = s.provider.ReadRoom(ctx, query.GetConversationId())
		if err != nil {
			return err
		}
		if input.GetKind() == realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_DECLINE_INVITATION {
			if !status.Active || status.RoomSID != input.GetRoomSid() {
				return server.Forbidden("group call invitation is no longer current")
			}
			decision := invitationDecision{ConversationID: query.GetConversationId(), RoomSID: status.RoomSID, ActorPTID: query.GetActorPtid()}
			if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&decision).Error; err != nil {
				return err
			}
		}
		var decisions []invitationDecision
		if err := s.db.WithContext(ctx).Where("conversation_id = ? AND room_sid = ?", query.GetConversationId(), status.RoomSID).
			Order("actor_ptid").Find(&decisions).Error; err != nil {
			return err
		}
		status.DeclinedActorPTIDs = make([]string, 0, len(decisions))
		members, err := s.members.ListGroupMemberPTIDs(ctx, query.GetConversationId())
		if err != nil {
			return err
		}
		for _, decision := range decisions {
			if containsPTID(members, decision.ActorPTID) {
				status.DeclinedActorPTIDs = append(status.DeclinedActorPTIDs, decision.ActorPTID)
			}
		}
		return nil
	}
	if input.GetKind() == realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_DECLINE_INVITATION {
		if query.GetActorDeviceId() == "" || input.GetRoomSid() == "" {
			return nil, server.BadRequest("endpoint invitation required")
		}
		err = s.authorityFence.WithGroupCallFence(ctx, query.GetConversationId(), mediaaccess.Endpoint{
			ActorPTID: query.GetActorPtid(), Home: home, DeviceID: query.GetActorDeviceId(),
		}, authority, epoch, read)
	} else {
		err = read()
	}
	return status, err
}
