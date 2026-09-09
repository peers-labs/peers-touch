package key_exchange

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	deliveryapplication "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	deliveryinfrastructure "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/interface/http"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	defaultDeviceInboxMaxUnackedItems = 10_000
	defaultDeviceInboxMaxUnackedBytes = 64 << 20
)

// Dependencies contains the shared capabilities that the Key Exchange owner
// consumes but must not implement.
type Dependencies struct {
	Federation application.FederationPort
}

// FederationCapability is the narrow peer-facing Key Exchange capability
// injected into the shared Federation composition. It is intentionally not an
// HTTP route owned by this subserver.
type FederationCapability interface {
	ClaimMLSKeyPackage(
		ctx context.Context,
		sourceAuthorityStationPeerID string,
		request *kemodel.ClaimMlsKeyPackageRequest,
	) (*kemodel.ClaimMlsKeyPackageResponse, error)
}

type systemClock struct{}

func (systemClock) Now() time.Time {
	return time.Now().UTC()
}

type uuidGenerator struct{}

func (uuidGenerator) NewID() string {
	return uuid.NewString()
}

type subServer struct {
	mu           sync.RWMutex
	status       server.Status
	api          *httpinterface.CanonicalAPI
	jwtWrapper   server.Wrapper
	dependencies Dependencies
}

// NewKeyExchangeSubServer preserves the Station factory signature. Production
// composition must use NewKeyExchangeSubServerWithDependencies until the
// shared Federation runtime provides a repository-owned adapter directly.
func NewKeyExchangeSubServer(opts ...option.Option) server.Subserver {
	return NewKeyExchangeSubServerWithDependencies(Dependencies{}, opts...)
}

// NewKeyExchangeSubServerWithDependencies constructs the canonical Key
// Exchange owner with its shared Federation boundary supplied explicitly.
func NewKeyExchangeSubServerWithDependencies(
	dependencies Dependencies,
	_ ...option.Option,
) server.Subserver {
	return &subServer{
		status:       server.StatusStopped,
		dependencies: dependencies,
	}
}

// Init composes canonical public material, Actor Device lookup, and Device
// Inbox delivery without registering any peer compatibility route.
func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.setStatus(server.StatusStarting)
	if s.dependencies.Federation == nil {
		return s.fail(fmt.Errorf(
			"key exchange: shared FederationPort dependency is required",
		))
	}

	database, err := store.GetRDS(ctx)
	if err != nil {
		return s.fail(fmt.Errorf("key exchange: get Station database: %w", err))
	}
	localStationID := strings.TrimSpace(
		nativefed.LocalIdentitySnapshot().StationPeerID.String(),
	)
	if localStationID == "" {
		return s.fail(fmt.Errorf(
			"key exchange: local Station peer identity unavailable",
		))
	}
	api, err := compose(
		ctx,
		database,
		localStationID,
		s.dependencies.Federation,
	)
	if err != nil {
		return s.fail(err)
	}

	provider := coreauth.NewJWTProvider(
		coreauth.Get().Secret,
		coreauth.Get().AccessTTL,
	)
	s.api = api
	s.jwtWrapper = withCanonicalKeyExchangeSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		resolveKeyExchangeSubjectPTID,
	)
	return nil
}

func (s *subServer) Start(context.Context, ...option.Option) error {
	s.setStatus(server.StatusRunning)
	return nil
}

func (s *subServer) Stop(context.Context) error {
	s.setStatus(server.StatusStopped)
	return nil
}

func (s *subServer) Name() string               { return "key_exchange" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

func (s *subServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// ClaimMLSKeyPackage exposes the authenticated owner operation to the shared
// Federation capability adapter without creating a Key Exchange peer route.
func (s *subServer) ClaimMLSKeyPackage(
	ctx context.Context,
	sourceAuthorityStationPeerID string,
	request *kemodel.ClaimMlsKeyPackageRequest,
) (*kemodel.ClaimMlsKeyPackageResponse, error) {
	if s.api == nil {
		return nil, domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.claim_mls_key_package",
			"canonical_api",
			"is not initialized",
		)
	}
	return s.api.ClaimMLSKeyPackage(
		ctx,
		sourceAuthorityStationPeerID,
		request,
	)
}

func compose(
	ctx context.Context,
	database *gorm.DB,
	localStationID string,
	federation application.FederationPort,
) (*httpinterface.CanonicalAPI, error) {
	canonicalStore, err := infrastructure.NewCanonicalStore(database)
	if err != nil {
		return nil, err
	}
	if err := canonicalStore.Migrate(ctx); err != nil {
		return nil, err
	}
	deviceDirectory, err := infrastructure.NewDeviceDirectory(database)
	if err != nil {
		return nil, err
	}
	deviceInboxRepository, err := deliveryinfrastructure.NewRepository(
		database,
		deliveryapplication.QueueLimits{
			MaxUnackedItems: defaultDeviceInboxMaxUnackedItems,
			MaxUnackedBytes: defaultDeviceInboxMaxUnackedBytes,
		},
	)
	if err != nil {
		return nil, err
	}
	clock := systemClock{}
	deviceInbox, err := infrastructure.NewDeviceInbox(
		deviceInboxRepository,
		clock,
		localStationID,
	)
	if err != nil {
		return nil, err
	}
	service, err := application.NewCanonicalService(
		canonicalStore,
		canonicalStore,
		deviceDirectory,
		deviceInbox,
		federation,
		clock,
		uuidGenerator{},
		localStationID,
	)
	if err != nil {
		return nil, err
	}
	return httpinterface.NewCanonicalAPI(service)
}

func (s *subServer) setStatus(status server.Status) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
}

func (s *subServer) fail(err error) error {
	s.setStatus(server.StatusError)
	return err
}

var (
	_ server.Subserver        = (*subServer)(nil)
	_ FederationCapability    = (*subServer)(nil)
	_ application.Clock       = systemClock{}
	_ application.IDGenerator = uuidGenerator{}
)
