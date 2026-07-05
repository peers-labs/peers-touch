package group_chat

import (
	"context"
	"strings"
	"sync"
	"time"

	application_group_chat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	groupChatProposalScopeName       = "group-chat-proposal-submit"
	groupChatEventApplyScopeName     = "group-chat-event-apply"
	groupChatEventSyncScopeName      = "group-chat-event-sync"
	groupChatProjectionSyncScopeName = "group-chat-projection-sync"
	groupChatSkdmDeliverScopeName    = "group-chat-skdm-deliver"
	groupChatProposalClaimGroup      = "group_ulid"
	groupChatProposalClaimProposal   = "proposal_ulid"
	groupChatProposalClaimActor      = "actor_did"
	groupChatEventClaimEvent         = "event_ulid"
	groupChatEventClaimSeq           = "seq"
	groupChatSkdmClaimIdempotency    = "idempotency_key"
	groupChatSkdmClaimRecipient      = "recipient_did"
	groupChatSkdmClaimDevice         = "recipient_device_id"
	groupChatProposalMaxTTL          = 60 * time.Second
)

var groupChatScopeOnce sync.Once

func registerGroupChatFederationScope() {
	groupChatScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        groupChatProposalScopeName,
			Description: "inbound federated group proposal submission",
			Policy: scope.Policy{
				TTLMax:           groupChatProposalMaxTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					groupChatProposalClaimGroup,
					groupChatProposalClaimProposal,
					groupChatProposalClaimActor,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        groupChatEventApplyScopeName,
			Description: "inbound federated committed group event apply",
			Policy: scope.Policy{
				TTLMax:           groupChatProposalMaxTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					groupChatProposalClaimGroup,
					groupChatEventClaimEvent,
					groupChatEventClaimSeq,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        groupChatEventSyncScopeName,
			Description: "inbound federated committed group event sync query",
			Policy: scope.Policy{
				TTLMax:           groupChatProposalMaxTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					groupChatProposalClaimGroup,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        groupChatProjectionSyncScopeName,
			Description: "inbound federated group read projection sync query",
			Policy: scope.Policy{
				TTLMax:           groupChatProposalMaxTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					groupChatProposalClaimGroup,
					groupChatEventClaimSeq,
					groupChatEventClaimEvent,
				},
			},
		})
		scope.MustRegister(scope.Scope{
			Name:        groupChatSkdmDeliverScopeName,
			Description: "inbound federated opaque group Sender Key envelope delivery",
			Policy: scope.Policy{
				TTLMax:           groupChatProposalMaxTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					groupChatProposalClaimGroup,
					groupChatProposalClaimActor,
					groupChatSkdmClaimIdempotency,
					groupChatSkdmClaimRecipient,
					groupChatSkdmClaimDevice,
				},
			},
		})
	})
}

type subServer struct {
	status                      server.Status
	addrs                       []string
	jwtWrapper                  server.Wrapper
	federationProposalWrapper   server.Wrapper
	federationEventWrapper      server.Wrapper
	federationSyncWrapper       server.Wrapper
	federationProjectionWrapper server.Wrapper
	federationSkdmWrapper       server.Wrapper
	service                     *service
	appService                  *application_group_chat.Service
	peerKeys                    authfed.PeerKeyStore
	proposalKeyCache            *authfed.KeyCache
	proposalTransport           groupProposalTransport
	eventTransport              groupEventTransport
	skdmTransport               groupSkdmTransport
	localStationID              string
}

func NewGroupChatSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status:            server.StatusStopped,
		addrs:             []string{},
		proposalTransport: relayGroupProposalTransport{},
		eventTransport:    relayGroupEventTransport{},
		skdmTransport:     relayGroupSkdmTransport{},
		service: &service{
			groups:       map[string]*group{},
			messages:     map[string][]message{},
			messagesByID: map[string]message{},
			members:      map[string]map[string]*member{},
			invitations:  map[string]*invitation{},
			settings:     map[string]map[string]groupSetting{},
			offline:      map[string][]offlineMessage{},
			unread:       map[string]map[string]int64{},
			threadReads:  map[string]threadRead{},
			groupEvents:  map[string][]domain.GroupEvent{},
			followers:    map[string]domain.FollowerProjection{},
			proposals:    map[string]domain.GroupProposalOutboxItem{},
			skdmOutbox:   map[string]domain.GroupSkdmEnvelope{},
		},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	registerGroupChatFederationScope()
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	if err := rds.AutoMigrate(
		&groupModel{},
		&memberModel{},
		&messageModel{},
		&MessageAttachmentModel{},
		&groupThreadReadModel{},
		&outboxModel{},
		&federationOutboxModel{},
		&groupProposalOutboxModel{},
		&groupSkdmOutboxModel{},
		&groupEventModel{},
		&groupFollowerProjectionModel{},
		&authfed.PeerKeyRow{},
		&invitationModel{},
		&settingModel{},
		&offlineModel{},
	); err != nil {
		return err
	}
	s.peerKeys = authfed.NewPeerKeyStoreGORMWithDB(rds)
	s.proposalKeyCache = authfed.Singleton()
	s.localStationID = localFederationAudience()
	s.federationProposalWrapper = serverwrapper.RequireFederationToken(
		groupChatProposalScopeName,
		s.peerKeys,
		httpadapter.StaticAudience(s.localStationID),
	)
	s.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		s.peerKeys,
		httpadapter.StaticAudience(s.localStationID),
	)
	s.federationSyncWrapper = serverwrapper.RequireFederationToken(
		groupChatEventSyncScopeName,
		s.peerKeys,
		httpadapter.StaticAudience(s.localStationID),
	)
	s.federationProjectionWrapper = serverwrapper.RequireFederationToken(
		groupChatProjectionSyncScopeName,
		s.peerKeys,
		httpadapter.StaticAudience(s.localStationID),
	)
	s.federationSkdmWrapper = serverwrapper.RequireFederationToken(
		groupChatSkdmDeliverScopeName,
		s.peerKeys,
		httpadapter.StaticAudience(s.localStationID),
	)
	s.service.db = rds
	s.service.authorityStationPeerID = s.localStationID
	if err := s.service.backfillThreadRootIDs(); err != nil {
		return err
	}
	if err := s.service.bootstrapFromDB(); err != nil {
		return err
	}
	s.appService = application_group_chat.NewService(s.service)
	return nil
}

func localFederationAudience() string {
	identity := nativefed.LocalIdentitySnapshot()
	if strings.TrimSpace(identity.StationPeerID.String()) != "" {
		return identity.StationPeerID.String()
	}
	if strings.TrimSpace(identity.StationDomain) != "" {
		return strings.TrimSpace(identity.StationDomain)
	}
	return foundationLocalAuthorityStation
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.service.dispatchOutbox()
				if s.eventTransport != nil {
					s.dispatchFederationOutbox(ctx, 20)
					s.dispatchFollowerEventSync(ctx, 20)
				}
				if s.proposalTransport != nil {
					s.dispatchProposalOutbox(ctx, 20)
				}
				if s.skdmTransport != nil {
					s.dispatchGroupSkdmOutbox(ctx, 20)
				}
			}
		}
	}()
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	_ = ctx
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "group_chat" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
