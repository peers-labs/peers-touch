package federation

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type subServer struct {
	mu     sync.RWMutex
	status server.Status

	jwtWrapper        server.Wrapper
	federationWrapper server.Wrapper

	federationSvc *application.FederationService
	ledgerSvc     *application.LedgerService
	projectionSvc *application.ProjectionService
	actorKeySvc   *domain.ActorKeyService
	syncManager   *LedgerSyncManager
}

func NewFederationSubServer(_ ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStarting

	scope.MustRegister(scope.Scope{
		Name:        FederationGovernanceSyncScope,
		Description: "station-to-station federation ledger sync",
		Policy: scope.Policy{
			TTLMax:           5 * time.Minute,
			AudienceRequired: true,
		},
	})

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	peerKeys := federation.NewPeerKeyStoreGORM("")
	s.federationWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireFederationToken(
			FederationGovernanceSyncScope,
			peerKeys,
			func(r *http.Request) (string, error) {
				return node.GetService().Options().Id, nil
			},
			false,
		),
	)

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	repos := infrastructure.NewRepos(rds)

	hashSvc := domain.NewHashService()
	sigSvc := domain.NewSignatureService()
	actorKeySvc := domain.NewActorKeyService(repos.ActorSigningKey)
	s.actorKeySvc = actorKeySvc
	replaySvc := domain.NewReplayService(repos.LedgerEvent, hashSvc, sigSvc)

	policyRegistry := policy.NewRegistry()
	policyRegistry.Register(policy.SingleAdmin, policy.NewSingleAdminPolicy())

	s.ledgerSvc = application.NewLedgerService(
		repos.Federation,
		repos.LedgerEvent,
		repos.Membership,
		hashSvc,
		sigSvc,
		policyRegistry,
	)

	s.federationSvc = application.NewFederationService(
		repos.Federation,
		repos.Membership,
		repos.ActorRole,
		s.ledgerSvc,
		actorKeySvc,
		replaySvc,
	)

	s.projectionSvc = application.NewProjectionService(
		repos.Federation,
		repos.Membership,
		repos.ActorRole,
		repos.SyncCursor,
	)

	publisher := NewLedgerEventPublisher(repos.ActorRole)
	s.ledgerSvc.SetOnAppended(func(ctx context.Context, event *pb.LedgerEvent) {
		if err := publisher.PublishToLocalActors(ctx, event); err != nil {
			log.Warnf(ctx, "[federation] SSE publish failed for event %s: %v", event.EventId, err)
		}
	})

	fedCache := federation.Singleton()
	localStationFn := func() string {
		defer func() {
			if r := recover(); r != nil {
				log.Warnf(context.Background(), "[federation] node.GetService() not ready: %v", r)
			}
		}()
		return node.GetService().Options().Id
	}

	s.syncManager = NewLedgerSyncManager(
		s.ledgerSvc,
		repos.Federation,
		repos.LedgerEvent,
		repos.SyncCursor,
		repos.Membership,
		publisher,
		hashSvc,
		NewHTTPLedgerFetcher(fedCache, localStationFn),
		"",
	)

	log.Infof(ctx, "[federation] subserver initialized")
	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusRunning
	s.syncManager.Start(ctx)
	log.Infof(ctx, "[federation] subserver started")
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStopped
	s.syncManager.Stop()
	log.Infof(ctx, "[federation] subserver stopped")
	return nil
}

func (s *subServer) Name() string                     { return "federation" }
func (s *subServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress { return server.SubserverAddress{} }
func (s *subServer) Status() server.Status            { return s.status }

func (s *subServer) Handlers() []server.Handler {
	jw := s.jwtWrapper
	fw := s.federationWrapper

	return []server.Handler{
		server.NewTypedHandler("fed-list-federations", "/sub-federation/federations", server.GET, s.handleListFederations, jw),
		server.NewTypedHandler("fed-create-federation", "/sub-federation/federations", server.POST, s.handleCreateFederation, jw),
		server.NewTypedHandler("fed-list-members", "/sub-federation/federations/:federation_id/stations", server.GET, s.handleListMemberStations, jw),
		server.NewTypedHandler("fed-join", "/sub-federation/federations/join", server.POST, s.handleJoinFederation, jw),
		server.NewTypedHandler("fed-leave", "/sub-federation/federations/:federation_id/leave", server.POST, s.handleLeaveFederation, jw),
		server.NewTypedHandler("fed-fetch-head", "/fed/v1/ledger/head", server.POST, s.handleFetchHead, fw),
		server.NewTypedHandler("fed-fetch-events", "/fed/v1/ledger/events", server.POST, s.handleFetchEvents, fw),
	}
}
