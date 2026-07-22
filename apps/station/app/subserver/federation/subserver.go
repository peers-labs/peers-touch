package federation

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touch "github.com/peers-labs/peers-touch/station/frame/touch"
)

const routeNameFederation = "federation"

type subServer struct {
	mu     sync.RWMutex
	status server.Status

	commonWrapper server.Wrapper
	jwtWrapper    server.Wrapper

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

	s.commonWrapper = touch.CommonAccessControlWrapper(routeNameFederation)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

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

	publisher := NewLedgerEventPublisher()
	s.ledgerSvc.SetOnAppended(func(ctx context.Context, event *pb.LedgerEvent) {
		if err := publisher.PublishToLocalActors(ctx, event); err != nil {
			log.Warnf(ctx, "[federation] SSE publish failed for event %s: %v", event.EventId, err)
		}
	})

	s.syncManager = NewLedgerSyncManager(
		s.ledgerSvc,
		repos.Federation,
		repos.LedgerEvent,
		repos.SyncCursor,
		repos.Membership,
		publisher,
		hashSvc,
		NewHTTPLedgerFetcher(),
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

	return []server.Handler{
		server.NewTypedHandler("fed-list-federations", "/sub-federation/federations", server.GET, s.handleListFederations, jw),
		server.NewTypedHandler("fed-create-federation", "/sub-federation/federations", server.POST, s.handleCreateFederation, jw),
		server.NewTypedHandler("fed-list-members", "/sub-federation/federations/:federation_id/stations", server.GET, s.handleListMemberStations, jw),
		server.NewTypedHandler("fed-join", "/sub-federation/federations/join", server.POST, s.handleJoinFederation, jw),
		server.NewTypedHandler("fed-leave", "/sub-federation/federations/:federation_id/leave", server.POST, s.handleLeaveFederation, jw),
		server.NewTypedHandler("fed-fetch-head", "/fed/v1/ledger/head", server.POST, s.handleFetchHead, jw),
		server.NewTypedHandler("fed-fetch-events", "/fed/v1/ledger/events", server.POST, s.handleFetchEvents, jw),
	}
}
