package conversation

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/follower"
	fedinf "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

const mlsLeaveIntentFederationScope = "conversation-mls-leave-intent"

const (
	leaveIntentClaimFederation     = "federation_id"
	leaveIntentClaimConversation   = "conversation_id"
	leaveIntentClaimIntent         = "intent_id"
	leaveIntentClaimDevice         = "actor_device_id"
	leaveIntentClaimAuthorityEpoch = "authority_epoch"
)

var mlsLeaveIntentFederationScopeOnce sync.Once

type MlsLeaveIntentRoute struct {
	FederationID           string
	AuthorityStationPeerID string
	AuthorityEpoch         int64
	HomeStationPeerID      string
	ConversationID         string
	ActorPtid              string
	ActorDeviceID          string
}

type MlsLeaveIntentForwarder interface {
	Submit(
		context.Context,
		*chat.MlsLeaveIntent,
	) (*chat.MlsLeaveIntent, error)
	ListPending(
		context.Context,
		MlsLeaveIntentRoute,
	) ([]*chat.MlsLeaveIntent, error)
}

type HTTPMlsLeaveIntentForwarder struct {
	db       *gorm.DB
	client   *http.Client
	keyCache *authfed.KeyCache
}

func registerMlsLeaveIntentFederationScope() {
	mlsLeaveIntentFederationScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        mlsLeaveIntentFederationScope,
			Description: "forward signed MLS leave intents to the group authority",
			Policy: scope.Policy{
				TTLMax:           60 * time.Second,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					leaveIntentClaimFederation,
					leaveIntentClaimConversation,
					leaveIntentClaimIntent,
					leaveIntentClaimDevice,
					leaveIntentClaimAuthorityEpoch,
				},
			},
		})
	})
}

func mlsLeaveIntentFederationAudience() httpadapter.AudienceResolver {
	return func(_ *http.Request) (string, error) {
		return conversationLocalAudience(), nil
	}
}

func NewHTTPMlsLeaveIntentForwarder(
	db *gorm.DB,
	keyCache *authfed.KeyCache,
) *HTTPMlsLeaveIntentForwarder {
	return &HTTPMlsLeaveIntentForwarder{
		db:       db,
		client:   &http.Client{Timeout: 15 * time.Second},
		keyCache: keyCache,
	}
}

func (f *HTTPMlsLeaveIntentForwarder) Submit(
	ctx context.Context,
	intent *chat.MlsLeaveIntent,
) (*chat.MlsLeaveIntent, error) {
	if intent == nil {
		return nil, fmt.Errorf("leave intent forward: intent is required")
	}
	route := MlsLeaveIntentRoute{
		FederationID:           intent.FederationId,
		AuthorityStationPeerID: intent.AuthorityStationPeerId,
		AuthorityEpoch:         intent.AuthorityEpoch,
		HomeStationPeerID:      intent.HomeStationPeerId,
		ConversationID:         intent.ConversationId,
		ActorPtid:              intent.ActorPtid,
		ActorDeviceID:          intent.ActorDeviceId,
	}
	request := &chat.SubmitMlsLeaveIntentRequest{Intent: intent}
	response := &chat.SubmitMlsLeaveIntentResponse{}
	if err := f.requestAuthority(
		ctx,
		route,
		intent.IntentId,
		"/federation/conversation/mls/leave-intent",
		request,
		response,
	); err != nil {
		return nil, err
	}
	if response.Intent == nil {
		return nil, fmt.Errorf("leave intent forward: authority returned no intent")
	}
	return response.Intent, nil
}

func (f *HTTPMlsLeaveIntentForwarder) ListPending(
	ctx context.Context,
	route MlsLeaveIntentRoute,
) ([]*chat.MlsLeaveIntent, error) {
	request := &chat.ListPendingMlsLeaveIntentsRequest{
		ConversationId: route.ConversationID,
	}
	response := &chat.ListPendingMlsLeaveIntentsResponse{}
	if err := f.requestAuthority(
		ctx,
		route,
		"",
		"/federation/conversation/mls/leave-intents",
		request,
		response,
	); err != nil {
		return nil, err
	}
	return response.Intents, nil
}

func (f *HTTPMlsLeaveIntentForwarder) requestAuthority(
	ctx context.Context,
	route MlsLeaveIntentRoute,
	intentID string,
	path string,
	requestBody proto.Message,
	responseBody proto.Message,
) error {
	repos := fedinf.NewRepos(f.db)
	authority, err := repos.Membership.GetByStation(
		ctx,
		route.FederationID,
		route.AuthorityStationPeerID,
	)
	if err != nil {
		return err
	}
	if authority == nil || authority.Status != "active" || authority.StationURL == "" {
		return fmt.Errorf("leave intent forward: authority endpoint unavailable")
	}
	identity := nativefed.LocalIdentitySnapshot()
	issuer := identity.StationPeerID.String()
	if issuer == "" {
		issuer = identity.StationDomain
	}
	home, err := repos.Membership.GetByStation(ctx, route.FederationID, issuer)
	if err != nil {
		return err
	}
	if issuer == "" ||
		(route.HomeStationPeerID != "" && route.HomeStationPeerID != issuer) ||
		home == nil ||
		home.Status != "active" {
		return fmt.Errorf("leave intent forward: Home Station is not active")
	}
	token, err := authfed.Mint(ctx, f.keyCache, authfed.MintRequest{
		Scope:    mlsLeaveIntentFederationScope,
		Issuer:   issuer,
		Audience: route.AuthorityStationPeerID,
		Subject:  route.ActorPtid,
		Custom: map[string]string{
			leaveIntentClaimFederation:     route.FederationID,
			leaveIntentClaimConversation:   route.ConversationID,
			leaveIntentClaimIntent:         intentID,
			leaveIntentClaimDevice:         route.ActorDeviceID,
			leaveIntentClaimAuthorityEpoch: strconv.FormatInt(route.AuthorityEpoch, 10),
		},
	})
	if err != nil {
		return fmt.Errorf("leave intent forward: mint peer token: %w", err)
	}
	body, err := protojson.Marshal(requestBody)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(authority.StationURL, "/") + path
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := f.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf(
			"leave intent forward: authority returned status %d",
			response.StatusCode,
		)
	}
	return protojson.Unmarshal(raw, responseBody)
}

func (s *subServer) submitAuthenticatedMlsLeaveIntent(
	ctx context.Context,
	authenticatedPtid string,
	authenticatedDeviceID string,
	intent *chat.MlsLeaveIntent,
) (*chat.MlsLeaveIntent, error) {
	if intent == nil {
		return nil, server.BadRequest("intent is required")
	}
	if authenticatedPtid != intent.ActorPtid ||
		authenticatedDeviceID == "" ||
		authenticatedDeviceID != intent.ActorDeviceId {
		return nil, server.Forbidden("leave intent actor device does not match authentication")
	}
	if intent.HomeStationPeerId != s.localStationID {
		return nil, server.Forbidden("leave intent Home Station does not match authentication")
	}
	if intent.AuthorityStationPeerId == s.localStationID {
		accepted, err := s.leaveService.Submit(
			ctx,
			authenticatedPtid,
			authenticatedDeviceID,
			intent,
		)
		if err != nil {
			return nil, mapConversationServiceError(err)
		}
		return accepted, nil
	}
	route, err := s.validateFollowerLeaveIntentRoute(
		ctx,
		authenticatedPtid,
		authenticatedDeviceID,
		intent.ConversationId,
	)
	if err != nil {
		return nil, err
	}
	if route.FederationID != intent.FederationId ||
		route.AuthorityStationPeerID != intent.AuthorityStationPeerId ||
		route.AuthorityEpoch != intent.AuthorityEpoch ||
		route.ActorPtid != intent.ActorPtid ||
		route.ActorDeviceID != intent.ActorDeviceId {
		return nil, server.Conflict("leave intent does not match the durable follower head")
	}
	if s.leaveIntentForwarder == nil {
		return nil, server.InternalError("leave intent forwarder unavailable")
	}
	accepted, err := s.leaveIntentForwarder.Submit(ctx, intent)
	if err != nil {
		return nil, server.InternalErrorWithCause("forward MLS leave intent", err)
	}
	return accepted, nil
}

func (s *subServer) listAuthenticatedMlsLeaveIntents(
	ctx context.Context,
	authenticatedPtid string,
	authenticatedDeviceID string,
	conversationID string,
) ([]*chat.MlsLeaveIntent, error) {
	if conversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if conversation, err := s.repo.GetConversation(ctx, conversationID); err == nil &&
		conversation.AuthorityStationPeerId == s.localStationID {
		intents, listErr := s.leaveService.ListPending(
			ctx,
			authenticatedPtid,
			authenticatedDeviceID,
			conversationID,
		)
		if listErr != nil {
			return nil, mapConversationServiceError(listErr)
		}
		return intents, nil
	}
	route, err := s.validateFollowerLeaveIntentRoute(
		ctx,
		authenticatedPtid,
		authenticatedDeviceID,
		conversationID,
	)
	if err != nil {
		return nil, err
	}
	if s.leaveIntentForwarder == nil {
		return nil, server.InternalError("leave intent forwarder unavailable")
	}
	intents, err := s.leaveIntentForwarder.ListPending(ctx, route)
	if err != nil {
		return nil, server.InternalErrorWithCause("list remote MLS leave intents", err)
	}
	return intents, nil
}

func (s *subServer) validateFollowerLeaveIntentRoute(
	ctx context.Context,
	ptid string,
	deviceID string,
	conversationID string,
) (MlsLeaveIntentRoute, error) {
	if s.db == nil {
		return MlsLeaveIntentRoute{}, server.InternalError("follower projection store unavailable")
	}
	var head follower.Head
	if err := s.db.WithContext(ctx).First(
		&head,
		"conversation_id = ?",
		conversationID,
	).Error; err != nil {
		return MlsLeaveIntentRoute{}, server.BadRequest("follower leave-intent head is unavailable")
	}
	if head.Status != "active" {
		return MlsLeaveIntentRoute{}, server.Conflict("follower group is not active")
	}
	var member follower.Member
	if err := s.db.WithContext(ctx).First(
		&member,
		"conversation_id = ? AND ptid = ?",
		conversationID,
		ptid,
	).Error; err != nil ||
		member.Status != int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE) {
		return MlsLeaveIntentRoute{}, server.Forbidden("leave-intent actor is not an active follower member")
	}
	var device follower.MemberDevice
	if err := s.db.WithContext(ctx).First(
		&device,
		"conversation_id = ? AND ptid = ? AND device_id = ?",
		conversationID,
		ptid,
		deviceID,
	).Error; err != nil || !device.Active {
		return MlsLeaveIntentRoute{}, server.Forbidden("leave-intent device is not an active follower MLS leaf")
	}
	return MlsLeaveIntentRoute{
		FederationID:           head.FederationID,
		AuthorityStationPeerID: head.AuthorityStationPeerID,
		AuthorityEpoch:         head.AuthorityEpoch,
		HomeStationPeerID:      s.localStationID,
		ConversationID:         conversationID,
		ActorPtid:              ptid,
		ActorDeviceID:          deviceID,
	}, nil
}

func (s *subServer) handleFederatedSubmitMlsLeaveIntent(
	ctx context.Context,
	req *chat.SubmitMlsLeaveIntentRequest,
) (*chat.SubmitMlsLeaveIntentResponse, error) {
	if req.Intent == nil {
		return nil, server.BadRequest("intent is required")
	}
	route, err := verifiedMlsLeaveIntentRoute(ctx, req.Intent.IntentId)
	if err != nil {
		return nil, err
	}
	if err := s.requireActiveLeaveIntentHomeStation(ctx, route); err != nil {
		return nil, err
	}
	intent := req.Intent
	if route.FederationID != intent.FederationId ||
		route.AuthorityStationPeerID != intent.AuthorityStationPeerId ||
		route.AuthorityEpoch != intent.AuthorityEpoch ||
		route.ConversationID != intent.ConversationId ||
		route.ActorPtid != intent.ActorPtid ||
		route.ActorDeviceID != intent.ActorDeviceId ||
		route.HomeStationPeerID != intent.HomeStationPeerId {
		return nil, server.Forbidden("federation token does not match the leave intent")
	}
	accepted, err := s.leaveService.Submit(
		ctx,
		route.ActorPtid,
		route.ActorDeviceID,
		intent,
	)
	if err != nil {
		return nil, mapConversationServiceError(err)
	}
	return &chat.SubmitMlsLeaveIntentResponse{Intent: accepted}, nil
}

func (s *subServer) handleFederatedListMlsLeaveIntents(
	ctx context.Context,
	req *chat.ListPendingMlsLeaveIntentsRequest,
) (*chat.ListPendingMlsLeaveIntentsResponse, error) {
	route, err := verifiedMlsLeaveIntentRoute(ctx, "")
	if err != nil {
		return nil, err
	}
	if err := s.requireActiveLeaveIntentHomeStation(ctx, route); err != nil {
		return nil, err
	}
	if req.ConversationId == "" || req.ConversationId != route.ConversationID {
		return nil, server.Forbidden("federation token does not match the leave-intent query")
	}
	intents, err := s.leaveService.ListPending(
		ctx,
		route.ActorPtid,
		route.ActorDeviceID,
		route.ConversationID,
	)
	if err != nil {
		return nil, mapConversationServiceError(err)
	}
	return &chat.ListPendingMlsLeaveIntentsResponse{Intents: intents}, nil
}

func (s *subServer) requireActiveLeaveIntentHomeStation(
	ctx context.Context,
	route MlsLeaveIntentRoute,
) error {
	if s.db == nil {
		return server.InternalError("Federation membership store unavailable")
	}
	active, err := (federationMembershipAdapter{
		repo: fedinf.NewRepos(s.db).Membership,
	}).IsActiveStation(ctx, route.FederationID, route.HomeStationPeerID)
	if err != nil {
		return server.InternalErrorWithCause("resolve leave-intent Home Station", err)
	}
	if !active {
		return server.Forbidden("leave-intent Home Station is not active")
	}
	return nil
}

func verifiedMlsLeaveIntentRoute(
	ctx context.Context,
	expectedIntentID string,
) (MlsLeaveIntentRoute, error) {
	verified := httpadapter.GetVerifiedClaims(ctx)
	if verified == nil {
		return MlsLeaveIntentRoute{}, server.Unauthorized("federation token required")
	}
	authorityEpoch, err := strconv.ParseInt(
		verified.Custom[leaveIntentClaimAuthorityEpoch],
		10,
		64,
	)
	if err != nil {
		return MlsLeaveIntentRoute{}, server.Forbidden("federation leave-intent authority epoch is invalid")
	}
	if verified.Scope != mlsLeaveIntentFederationScope ||
		verified.Audience != conversationLocalAudience() ||
		verified.Issuer == "" ||
		verified.Subject == "" ||
		verified.Custom[leaveIntentClaimFederation] == "" ||
		verified.Custom[leaveIntentClaimConversation] == "" ||
		verified.Custom[leaveIntentClaimDevice] == "" ||
		verified.Custom[leaveIntentClaimIntent] != expectedIntentID {
		return MlsLeaveIntentRoute{}, server.Forbidden("federation leave-intent claims are incomplete")
	}
	return MlsLeaveIntentRoute{
		FederationID:           verified.Custom[leaveIntentClaimFederation],
		AuthorityStationPeerID: verified.Audience,
		AuthorityEpoch:         authorityEpoch,
		HomeStationPeerID:      verified.Issuer,
		ConversationID:         verified.Custom[leaveIntentClaimConversation],
		ActorPtid:              verified.Subject,
		ActorDeviceID:          verified.Custom[leaveIntentClaimDevice],
	}, nil
}
