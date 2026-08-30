package key_exchange

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

const (
	keyExchangeFederatedFetchScopeName = "key-exchange-bundle-fetch"
	keyExchangeClaimActor              = "actor_ptid"
	keyExchangeClaimDevice             = "device_id"
	keyExchangeFederationTTL           = 60 * time.Second
	keyExchangeFallbackLocalStation    = "local"
)

var keyExchangeScopeOnce sync.Once

func registerKeyExchangeFederationScope() {
	keyExchangeScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        keyExchangeFederatedFetchScopeName,
			Description: "inbound federated key bundle fetch",
			Policy: scope.Policy{
				TTLMax:           keyExchangeFederationTTL,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					keyExchangeClaimActor,
					keyExchangeClaimDevice,
				},
			},
		})
	})
}

type subServer struct {
	status                 server.Status
	addrs                  []string
	jwtWrapper             server.Wrapper
	federationFetchWrapper server.Wrapper
	service                *application.Service
	repo                   *infrastructure.GormRepo
	deviceStore            *touchactor.DeviceStore
	peerKeys               authfed.PeerKeyStore
	keyCache               *authfed.KeyCache
	localStationID         string
}

// NewKeyExchangeSubServer constructs the key_exchange HTTP subserver (E2E public key bundles).
func NewKeyExchangeSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	registerKeyExchangeFederationScope()

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = withCanonicalKeyExchangeSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		resolveKeyExchangeSubjectPTID,
	)

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	repo := infrastructure.NewGormRepo(rds)
	if err := repo.AutoMigrate(); err != nil {
		return err
	}

	s.repo = repo
	s.service = application.NewService(repo)
	s.deviceStore = touchactor.NewDeviceStore(rds)
	s.peerKeys = authfed.NewPeerKeyStoreGORMWithDB(rds)
	s.keyCache = authfed.Singleton()
	s.localStationID = keyExchangeLocalFederationAudience()
	s.federationFetchWrapper = serverwrapper.RequireFederationToken(
		keyExchangeFederatedFetchScopeName,
		s.peerKeys,
		keyExchangeDynamicFederationAudienceResolver(),
	)

	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "key_exchange" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }

func keyExchangeLocalFederationAudience() string {
	identity := nativefed.LocalIdentitySnapshot()
	if strings.TrimSpace(identity.StationPeerID.String()) != "" {
		return identity.StationPeerID.String()
	}
	if strings.TrimSpace(identity.StationDomain) != "" {
		return strings.TrimSpace(identity.StationDomain)
	}
	return keyExchangeFallbackLocalStation
}

func (s *subServer) currentLocalStationID() string {
	current := strings.TrimSpace(keyExchangeLocalFederationAudience())
	if current != "" && current != keyExchangeFallbackLocalStation {
		return current
	}
	if s != nil {
		configured := strings.TrimSpace(s.localStationID)
		if configured != "" {
			return configured
		}
	}
	if current != "" {
		return current
	}
	return keyExchangeFallbackLocalStation
}

func keyExchangeDynamicFederationAudienceResolver() httpadapter.AudienceResolver {
	return func(*http.Request) (string, error) {
		return keyExchangeLocalFederationAudience(), nil
	}
}
