package federation

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const deliveryRuntimeRestartDelay = time.Second

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
	govClient     RemoteGovernanceClient

	deliveryRuntime *federationruntime.Runtime
	deliveryCancel  context.CancelFunc
	deliveryWait    sync.WaitGroup
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

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	peerKeys := authfed.NewPeerKeyStoreGORMWithDB(rds)
	s.federationWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireFederationToken(
			FederationGovernanceSyncScope,
			peerKeys,
			func(r *http.Request) (string, error) {
				peerID := localStationPeerID()
				if peerID == "" {
					return "", fmt.Errorf("local Station peer identity unavailable")
				}
				return peerID, nil
			},
			false,
		),
	)

	if err := infrastructure.MigrateSchema(rds); err != nil {
		return fmt.Errorf("migrate federation schema: %w", err)
	}

	localStationID := localStationPeerID()
	if localStationID == "" {
		return fmt.Errorf("initialize Federation delivery: local Station peer identity unavailable")
	}
	s.deliveryRuntime, err = federationruntime.NewRuntime(
		ctx,
		federationruntime.RuntimeConfig{
			Database:           rds,
			LocalStationPeerID: localStationID,
			KeyCache:           authfed.Singleton(),
			PeerKeys:           peerKeys,
			Clock:              delivery.SystemClock{},
			HTTPClient:         &http.Client{Timeout: 15 * time.Second},
			Relay:              federationruntime.LiveRelayAccess{},
			Dispatcher: delivery.DispatcherConfig{
				WorkerID:      "federation:" + localStationID,
				BatchSize:     100,
				LeaseDuration: 30 * time.Second,
				IdleDelay:     time.Second,
				RetryBackoff: delivery.RetryBackoff{
					Initial: time.Second,
					Maximum: time.Minute,
				},
			},
			PeerEndpointResolver: resolveFederationPeerEndpoint,
		},
	)
	if err != nil {
		return fmt.Errorf("initialize shared Federation delivery: %w", err)
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

	fedCache := authfed.Singleton()
	localStationFn := func() string {
		return localStationPeerID()
	}

	fetcher := NewHTTPLedgerFetcher(fedCache, localStationFn)

	s.syncManager = NewLedgerSyncManager(
		s.ledgerSvc,
		repos.Federation,
		repos.LedgerEvent,
		repos.SyncCursor,
		repos.Membership,
		publisher,
		hashSvc,
		fetcher,
		"",
	)
	s.govClient = fetcher

	log.Infof(ctx, "[federation] subserver initialized")
	return nil
}

func localStationPeerID() string {
	identity := nativefed.LocalIdentitySnapshot()
	if identity.StationPeerID == "" {
		return ""
	}
	return identity.StationPeerID.String()
}

func localStationURL() string {
	domain := strings.TrimSpace(nativefed.LocalIdentitySnapshot().StationDomain)
	if domain == "" {
		return ""
	}
	if strings.HasPrefix(domain, "http://") || strings.HasPrefix(domain, "https://") {
		return strings.TrimRight(domain, "/")
	}
	return "http://" + strings.TrimRight(domain, "/")
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deliveryRuntime == nil {
		s.status = server.StatusError
		return fmt.Errorf("start Federation delivery: runtime is not initialized")
	}

	deliveryContext, cancel := context.WithCancel(ctx)
	s.deliveryCancel = cancel
	s.deliveryWait.Add(1)
	go func() {
		defer s.deliveryWait.Done()
		s.runDeliveryRuntime(deliveryContext)
	}()

	s.status = server.StatusRunning
	s.syncManager.Start(ctx)
	log.Infof(ctx, "[federation] subserver started")
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStopping
	if s.deliveryCancel != nil {
		s.deliveryCancel()
		s.deliveryCancel = nil
	}
	s.deliveryWait.Wait()
	s.syncManager.Stop()
	s.status = server.StatusStopped
	log.Infof(ctx, "[federation] subserver stopped")
	return nil
}

func (s *subServer) Name() string                     { return "federation" }
func (s *subServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress { return server.SubserverAddress{} }
func (s *subServer) Status() server.Status            { return s.status }

// FederationDeliveryRuntime exposes the process-scoped shared transport to domain subservers.
func (s *subServer) FederationDeliveryRuntime() *federationruntime.Runtime {
	return s.deliveryRuntime
}

func (s *subServer) Handlers() []server.Handler {
	jw := s.jwtWrapper
	fw := s.federationWrapper

	handlers := []server.Handler{
		server.NewTypedHandler("fed-list-federations", "/sub-federation/federations", server.GET, s.handleListFederations, jw),
		server.NewTypedHandler("fed-create-federation", "/sub-federation/federations", server.POST, s.handleCreateFederation, jw),
		server.NewTypedHandler("fed-list-members", "/sub-federation/federations/:federation_id/stations", server.GET, s.handleListMemberStations, jw),
		server.NewTypedHandler("fed-join", "/sub-federation/federations/join", server.POST, s.handleJoinFederation, jw),
		server.NewTypedHandler("fed-leave", "/sub-federation/federations/:federation_id/leave", server.POST, s.handleLeaveFederation, jw),
		server.NewTypedHandler("fed-delete", "/sub-federation/federations/:federation_id/delete", server.POST, s.handleDeleteFederation, jw),
		server.NewTypedHandler("fed-catalog-search", "/sub-federation/catalog/search", server.POST, s.handleCatalogSearch, jw),
		server.NewTypedHandler("fed-fetch-head", "/fed/v1/ledger/head", server.POST, s.handleFetchHead, fw),
		server.NewTypedHandler("fed-fetch-events", "/fed/v1/ledger/events", server.POST, s.handleFetchEvents, fw),
		server.NewTypedHandler("fed-submit-proposal", "/fed/v1/governance/submit-proposal", server.POST, s.handleSubmitProposal),
	}
	if s.deliveryRuntime != nil {
		handlers = append(handlers, s.deliveryRuntime.Handlers()...)
	}

	return handlers
}

func (s *subServer) runDeliveryRuntime(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		err := s.deliveryRuntime.Run(ctx)
		if err == nil || ctx.Err() != nil {
			return
		}
		log.Errorf(
			ctx,
			"[federation] shared delivery dispatcher stopped; restarting: %v",
			err,
		)
		timer.Reset(deliveryRuntimeRestartDelay)
	}
}

var _ federationruntime.RuntimeProvider = (*subServer)(nil)
