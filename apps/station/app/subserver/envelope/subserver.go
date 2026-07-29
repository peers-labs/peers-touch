package envelope

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"

	"github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	envelopeFederationScopeName      = "envelope-federation-deliver"
	envelopeFederationMaxTTL         = 60 * time.Second
	envelopeFederationClaimSender    = "sender_ptid"
	envelopeFederationClaimConv      = "conversation_id"
	envelopeFederationClaimIdempKey  = "idempotency_key"
)

var envelopeScopeOnce sync.Once

func registerEnvelopeFederationScope() {
	envelopeScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        envelopeFederationScopeName,
			Description: "inbound federated envelope delivery",
			Policy: scope.Policy{
				TTLMax:           envelopeFederationMaxTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					envelopeFederationClaimSender,
					envelopeFederationClaimConv,
					envelopeFederationClaimIdempKey,
				},
			},
		})
	})
}

type subServer struct {
	status             server.Status
	jwtWrapper         server.Wrapper
	federationWrapper  server.Wrapper
	service            Service
	dispatcher         OutboxDispatcher
	peerKeys           authfed.PeerKeyStore
	localStationID     string
}

func NewEnvelopeSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	registerEnvelopeFederationScope()

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	repo := infrastructure.NewPostgresRepository(rds)
	if err := repo.AutoMigrate(); err != nil {
		return err
	}

	s.localStationID = envelopeLocalAudience()
	s.peerKeys = authfed.NewPeerKeyStoreGORMWithDB(rds)

	s.federationWrapper = serverwrapper.RequireFederationToken(
		envelopeFederationScopeName,
		s.peerKeys,
		envelopeAudienceResolver(),
	)

	bus := NewSSEDeviceBus()
	s.service = NewService(repo, bus, envelopeLocalAudience)

	transport := NewHTTPFederationTransport(authfed.Singleton())
	s.dispatcher = NewDispatcher(repo, transport)

	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return s.dispatcher.Start(ctx)
}

func (s *subServer) Stop(ctx context.Context) error {
	s.dispatcher.Stop()
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "envelope" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}
func (s *subServer) Status() server.Status { return s.status }

func (s *subServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()
	idempotencyWrapper := serverwrapper.IdempotencyKey()
	return []server.Handler{
		server.NewTypedHandler("env-submit", "/envelope/submit", server.POST,
			s.handleSubmit, logID, deviceIDWrapper, idempotencyWrapper, s.jwtWrapper),
		server.NewTypedHandler("env-ack", "/envelope/ack", server.POST,
			s.handleAck, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("env-resume", "/envelope/resume", server.GET,
			s.handleResume, logID, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("env-fed-deliver", "/envelope/federation/deliver", server.POST,
			s.handleFederationDeliver, logID, s.federationWrapper),
	}
}

func envelopeLocalAudience() string {
	identity := nativefed.LocalIdentitySnapshot()
	if strings.TrimSpace(identity.StationPeerID.String()) != "" {
		return identity.StationPeerID.String()
	}
	if strings.TrimSpace(identity.StationDomain) != "" {
		return strings.TrimSpace(identity.StationDomain)
	}
	return ""
}

func envelopeAudienceResolver() httpadapter.AudienceResolver {
	return func(_ *http.Request) (string, error) {
		return envelopeLocalAudience(), nil
	}
}

// noopFederationTransport is a placeholder until federation relay is wired.
type noopFederationTransport struct{}

func (*noopFederationTransport) Forward(_ context.Context, _ string, _ *chat.StationEnvelope) error {
	return nil
}
