package groupcall

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

// Handlers returns the HTTP handlers registered by the groupcall subserver.
func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler(
			"groupcall-join",
			"/group-call/join",
			server.POST,
			s.handleJoin,
			logIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler("groupcall-status", "/group-call/status", server.POST,
			s.handleRoomStatus, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("groupcall-decline", "/group-call/decline", server.POST,
			s.handleDeclineInvitation, logIDWrapper, s.jwtWrapper),
		server.NewHTTPHandler(
			"groupcall-webhook",
			"/hooks/livekit",
			server.POST,
			s.handleWebhook,
			logIDWrapper,
		),
	}
}

// handleJoin validates group membership, creates or finds the LiveKit
// room, and returns a participant token to the caller.
func (s *subServer) handleJoin(ctx context.Context, req *JoinRequest) (*JoinResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil || req.GroupULID == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	actorPTID := subject.ID
	authority, federationID, authorityEpoch, memberHome, activeMember, err :=
		s.authority.ResolveGroupCallAuthority(ctx, req.GroupULID, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"failed to resolve group call authority",
			err,
		)
	}
	if !activeMember {
		return nil, server.Forbidden("caller is not a member of this group")
	}
	localStation := s.federation.LocalStationPeerID()
	if authority == "" || localStation == "" {
		return nil, server.InternalError("group call authority is unavailable")
	}
	if memberHome != localStation {
		return nil, server.Forbidden(
			"group call join must originate from the caller's Home Station",
		)
	}
	return s.issueHome(ctx, subject, req.GroupULID, authority, federationID, authorityEpoch)
}

func (s *subServer) issueAtAuthority(ctx context.Context, grant endpointGrant) (*JoinResponse, error) {
	if grant.Authority == s.federation.LocalStationPeerID() {
		return s.mintEndpointGrant(ctx, grant)
	}
	input := &realtime.GroupCallAuthorityJoinRequest{
		ConversationId: grant.ConversationID, ActorPtid: grant.ActorPTID,
		SourceHomeStationPeerId: grant.Home, FederationId: grant.FederationID,
		AuthorityEpoch: grant.AuthorityEpoch, EndpointGrant: grant.wire(),
	}
	response := &realtime.GroupCallAuthorityJoinResponse{}
	err := s.federation.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: grant.Authority,
		Route:               federationruntime.PeerRouteGroupCallAuthorityJoin,
		Subject:             grant.ActorPTID,
		Claims: map[string]string{
			federationruntime.ClaimFederationID:           grant.FederationID,
			federationruntime.ClaimConversationID:         grant.ConversationID,
			federationruntime.ClaimActorPTID:              grant.ActorPTID,
			federationruntime.ClaimAuthorityEpoch:         strconv.FormatUint(grant.AuthorityEpoch, 10),
			federationruntime.ClaimSourceStationPeerID:    grant.Home,
			federationruntime.ClaimTargetStationPeerID:    grant.Authority,
			federationruntime.ClaimCanonicalRequestSHA256: groupRequestDigest(input),
		},
		Request:  input,
		Response: response,
	})
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"failed to reach group call authority",
			err,
		)
	}
	if response.GetDecision() !=
		realtime.GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_AUTHORIZED {
		return nil, server.Forbidden("caller is not a member of this group")
	}
	if strings.TrimSpace(response.GetUrl()) == "" ||
		strings.TrimSpace(response.GetToken()) == "" ||
		response.GetRoomName() != roomName(grant.ConversationID) ||
		response.GetGrantId() != grant.GrantID || response.GetParticipantIdentity() != grant.identity() {
		return nil, server.InternalError(
			"group call authority returned an incomplete join grant",
		)
	}

	return &JoinResponse{
		URL:      response.GetUrl(),
		Token:    response.GetToken(),
		RoomName: response.GetRoomName(),
		GrantID:  response.GetGrantId(), ParticipantIdentity: response.GetParticipantIdentity(),
	}, nil
}

func groupRequestDigest(input proto.Message) string {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

// FederationPeerHandler exposes the authority-only join capability through the
// canonical Federation route registry.
func (s *subServer) FederationPeerHandler(
	route federationruntime.PeerRoute,
) (server.EndpointHandler, error) {
	if route == federationruntime.PeerRouteGroupCallEndpointControl {
		return s.handleEndpointControl, nil
	}
	if route != federationruntime.PeerRouteGroupCallAuthorityJoin {
		return nil, fmt.Errorf("groupcall does not own Federation peer route %q", route)
	}
	return s.handleFederatedAuthorityJoin, nil
}

func (s *subServer) handleFederatedAuthorityJoin(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &realtime.GroupCallAuthorityJoinRequest{}
	if err := decodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	localStation := s.federation.LocalStationPeerID()
	if err := validateAuthorityJoinClaims(claims, input, localStation); err != nil {
		return err
	}
	result, err := s.joinForFederatedAuthority(ctx, input)
	if err != nil {
		return err
	}

	return writePeerResponse(response, result)
}

func (s *subServer) joinForFederatedAuthority(
	ctx context.Context,
	input *realtime.GroupCallAuthorityJoinRequest,
) (*realtime.GroupCallAuthorityJoinResponse, error) {
	localStation := s.federation.LocalStationPeerID()
	authority, federationID, authorityEpoch, memberHome, activeMember, err :=
		s.authority.ResolveGroupCallAuthority(
			ctx,
			input.GetConversationId(),
			input.GetActorPtid(),
		)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"failed to verify authority group membership",
			err,
		)
	}
	if !activeMember {
		return &realtime.GroupCallAuthorityJoinResponse{
			Decision: realtime.GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_NOT_MEMBER,
		}, nil
	}
	if authority != localStation ||
		memberHome != input.GetSourceHomeStationPeerId() ||
		federationID != input.GetFederationId() ||
		authorityEpoch != input.GetAuthorityEpoch() {
		return nil, server.Forbidden(
			"Federation group call request does not match Conversation authority",
		)
	}
	endpoint, err := grantFromWire(input.GetEndpointGrant(), grantAuthority)
	if err != nil {
		return nil, server.Forbidden("group call endpoint authorization is missing")
	}
	if endpoint.Authority != authority || endpoint.Home != memberHome ||
		endpoint.ActorPTID != input.GetActorPtid() || endpoint.ConversationID != input.GetConversationId() ||
		endpoint.FederationID != federationID || endpoint.AuthorityEpoch != authorityEpoch {
		return nil, server.Forbidden("group call endpoint does not match authority scope")
	}
	grant, err := s.mintEndpointGrant(ctx, endpoint)
	if err != nil {
		return nil, err
	}

	return &realtime.GroupCallAuthorityJoinResponse{
		Decision: realtime.GroupCallAuthorityJoinDecision_GROUP_CALL_AUTHORITY_JOIN_DECISION_AUTHORIZED,
		Url:      grant.URL,
		Token:    grant.Token,
		RoomName: grant.RoomName,
		GrantId:  grant.GrantID, ParticipantIdentity: grant.ParticipantIdentity,
	}, nil
}

func validateAuthorityJoinClaims(
	claims *authfed.VerifiedClaims,
	input *realtime.GroupCallAuthorityJoinRequest,
	localStation string,
) error {
	if claims == nil ||
		input == nil ||
		strings.TrimSpace(input.GetConversationId()) == "" ||
		strings.TrimSpace(input.GetActorPtid()) == "" ||
		strings.TrimSpace(input.GetSourceHomeStationPeerId()) == "" ||
		strings.TrimSpace(input.GetFederationId()) == "" ||
		input.GetAuthorityEpoch() == 0 ||
		claims.Issuer != input.GetSourceHomeStationPeerId() ||
		claims.Audience != localStation ||
		claims.Subject != input.GetActorPtid() ||
		claims.Custom[federationruntime.ClaimFederationID] != input.GetFederationId() ||
		claims.Custom[federationruntime.ClaimConversationID] != input.GetConversationId() ||
		claims.Custom[federationruntime.ClaimActorPTID] != input.GetActorPtid() ||
		claims.Custom[federationruntime.ClaimAuthorityEpoch] !=
			strconv.FormatUint(input.GetAuthorityEpoch(), 10) ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the group call authority request",
		)
	}
	if claims.Custom[federationruntime.ClaimCanonicalRequestSHA256] == "" ||
		claims.Custom[federationruntime.ClaimCanonicalRequestSHA256] != groupRequestDigest(input) {
		return server.Forbidden("Federation endpoint grant digest does not match")
	}
	return nil
}

func decodePeerRequest(request server.Request, message proto.Message) error {
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

func writePeerResponse(response server.Response, message proto.Message) error {
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

// handleWebhook receives LiveKit webhook callbacks. LiveKit signs its
// own requests via the Authorization header; no Station JWT is needed.
func (s *subServer) handleWebhook(ctx context.Context, req server.Request, resp server.Response) error {
	body := req.Body()
	if len(body) == 0 {
		resp.WriteHeader(http.StatusBadRequest)
		return nil
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "/hooks/livekit", bytes.NewReader(body))
	if err != nil {
		resp.WriteHeader(http.StatusInternalServerError)
		return nil
	}
	httpReq.Header.Set("Authorization", req.Header()["Authorization"])
	httpReq.Header.Set("Content-Type", "application/json")

	if err := s.provider.HandleWebhook(ctx, httpReq); err != nil {
		logger.DefaultHelper.Warnf("groupcall: webhook processing failed: %v", err)
		resp.WriteHeader(http.StatusBadRequest)
		return nil
	}

	resp.WriteHeader(http.StatusOK)
	return nil
}

func containsPTID(ptids []string, needle string) bool {
	for _, p := range ptids {
		if p == needle {
			return true
		}
	}
	return false
}
