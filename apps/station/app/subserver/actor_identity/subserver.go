package actor_identity

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	actoridentityhttp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/interface/http"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

const (
	actorDeviceEnrollPath = "/device/enroll"
	actorDeviceListPath   = "/device/list"
	actorDeviceRevokePath = "/device/revoke"
)

type subServerDependencies struct {
	database        func(context.Context) (*gorm.DB, error)
	localStationID  func() (string, error)
	authProvider    func() coreauth.Provider
	subjectResolver serverwrapper.SubjectResolver
	clock           application.Clock
}

type subServer struct {
	mu sync.RWMutex

	status       server.Status
	addrs        []string
	dependencies subServerDependencies
	jwtWrapper   server.Wrapper
	repository   *persistence.Repository
	service      *application.Service
	httpHandler  *actoridentityhttp.Handler
	capabilities *actorCapabilities
}

// NewActorIdentitySubServer constructs the production Actor Identity HTTP subserver.
func NewActorIdentitySubServer(opts ...option.Option) server.Subserver {
	return newActorIdentitySubServer(productionSubServerDependencies())
}

func newActorIdentitySubServer(dependencies subServerDependencies) *subServer {
	return &subServer{
		status:       server.StatusStopped,
		addrs:        []string{},
		dependencies: dependencies,
	}
}

func productionSubServerDependencies() subServerDependencies {
	return subServerDependencies{
		database: func(ctx context.Context) (*gorm.DB, error) {
			return store.GetRDS(ctx)
		},
		localStationID:  resolveLocalStationID,
		authProvider:    newActorIdentityAuthProvider,
		subjectResolver: touchactor.ResolveSubjectPTID,
		clock:           time.Now,
	}
}

func newActorIdentityAuthProvider() coreauth.Provider {
	config := coreauth.Get()

	return coreauth.NewJWTProvider(config.Secret, config.AccessTTL)
}

func resolveLocalStationID() (string, error) {
	identity := nativefed.LocalIdentitySnapshot()
	stationPeerID := strings.TrimSpace(identity.StationPeerID.String())
	if stationPeerID == "" {
		return "", domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.resolve_local_station",
			"station_peer_id",
			"is unavailable",
		)
	}

	return stationPeerID, nil
}

// Init composes the canonical repository, service, HTTP adapter, and auth boundary.
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	if err := s.beginInitialization(); err != nil {
		logger.Errorf(ctx, "actor identity subserver initialization rejected: %v", err)

		return err
	}

	if err := s.initialize(ctx); err != nil {
		s.setStatus(server.StatusError)
		logger.Errorf(ctx, "actor identity subserver initialization failed: %v", err)

		return err
	}

	logger.Info(ctx, "actor identity subserver initialized")

	return nil
}

func (s *subServer) beginInitialization() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status != server.StatusStopped {
		return fmt.Errorf(
			"actor identity subserver initialization requires stopped status, got %s",
			s.status,
		)
	}
	s.status = server.StatusStarting

	return nil
}

func (s *subServer) initialize(ctx context.Context) error {
	if err := validateSubServerDependencies(s.dependencies); err != nil {
		return err
	}

	localStationID, err := s.dependencies.localStationID()
	if err != nil {
		return fmt.Errorf("resolve local Station identity: %w", err)
	}
	rds, err := s.dependencies.database(ctx)
	if err != nil {
		return fmt.Errorf("open Actor Identity database: %w", err)
	}
	repository, err := persistence.NewRepository(rds)
	if err != nil {
		return fmt.Errorf("construct Actor Identity repository: %w", err)
	}
	if err := repository.AutoMigrate(); err != nil {
		return fmt.Errorf("migrate Actor Identity schema: %w", err)
	}
	service, err := application.NewService(
		repository,
		localStationID,
		s.dependencies.clock,
	)
	if err != nil {
		return fmt.Errorf("construct Actor Identity service: %w", err)
	}
	httpHandler, err := actoridentityhttp.NewHandler(service)
	if err != nil {
		return fmt.Errorf("construct Actor Identity HTTP handler: %w", err)
	}
	endpointManifests, err := application.NewEndpointManifestService(
		repository,
		application.EndpointManifestSignerFunc(signProductionEndpointManifest),
		localStationID,
		s.dependencies.clock,
	)
	if err != nil {
		return fmt.Errorf("construct Actor endpoint manifest service: %w", err)
	}
	capabilities, err := newActorCapabilities(
		endpointManifests,
		repository,
		localStationID,
		productionVerifiedProfileDeviceKeyHydratorFactory,
	)
	if err != nil {
		return fmt.Errorf("construct Actor capability provider: %w", err)
	}
	provider := s.dependencies.authProvider()
	if provider == nil {
		return fmt.Errorf("construct Actor Identity auth provider: provider is required")
	}
	jwtWrapper := serverwrapper.CanonicalSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		s.dependencies.subjectResolver,
	)

	s.mu.Lock()
	s.repository = repository
	s.service = service
	s.httpHandler = httpHandler
	s.capabilities = capabilities
	s.jwtWrapper = jwtWrapper
	s.mu.Unlock()

	return nil
}

func validateSubServerDependencies(dependencies subServerDependencies) error {
	switch {
	case dependencies.database == nil:
		return fmt.Errorf("actor identity database provider is required")
	case dependencies.localStationID == nil:
		return fmt.Errorf("actor identity local Station resolver is required")
	case dependencies.authProvider == nil:
		return fmt.Errorf("actor identity auth provider is required")
	case dependencies.subjectResolver == nil:
		return fmt.Errorf("actor identity subject resolver is required")
	case dependencies.clock == nil:
		return fmt.Errorf("actor identity clock is required")
	default:
		return nil
	}
}

// Start transitions an initialized Actor Identity subserver into running state.
func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	if s.status != server.StatusStarting || s.httpHandler == nil || s.jwtWrapper == nil {
		currentStatus := s.status
		s.status = server.StatusError
		s.mu.Unlock()

		err := fmt.Errorf(
			"actor identity subserver start requires initialized status, got %s",
			currentStatus,
		)
		logger.Errorf(ctx, "actor identity subserver start failed: %v", err)

		return err
	}
	s.status = server.StatusRunning
	s.mu.Unlock()

	logger.Info(ctx, "actor identity subserver started")

	return nil
}

// Stop transitions Actor Identity to stopped without closing the shared Station store.
func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	if s.status == server.StatusStopped {
		s.mu.Unlock()

		return nil
	}
	s.status = server.StatusStopping
	s.status = server.StatusStopped
	s.mu.Unlock()

	logger.Info(ctx, "actor identity subserver stopped")

	return nil
}

// Name returns the stable runtime name for Actor Identity.
func (s *subServer) Name() string {
	return "actor_identity"
}

// Type identifies Actor Identity as an HTTP subserver.
func (s *subServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address reports that Actor Identity is mounted on the parent Station listener.
func (s *subServer) Address() server.SubserverAddress {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return server.SubserverAddress{
		Address: append([]string(nil), s.addrs...),
	}
}

// Status returns the current Actor Identity lifecycle state.
func (s *subServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.status
}

// Handlers registers only the canonical Actor Identity device lifecycle routes.
func (s *subServer) Handlers() []server.Handler {
	s.mu.RLock()
	httpHandler := s.httpHandler
	jwtWrapper := s.jwtWrapper
	s.mu.RUnlock()
	if httpHandler == nil || jwtWrapper == nil {
		return nil
	}

	logIDWrapper := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()

	return []server.Handler{
		server.NewTypedHandler(
			"actor-device-enroll",
			actorDeviceEnrollPath,
			server.POST,
			s.handleEnrollDevice,
			logIDWrapper,
			deviceIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"actor-device-list",
			actorDeviceListPath,
			server.GET,
			s.handleListDevices,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"actor-device-revoke",
			actorDeviceRevokePath,
			server.POST,
			s.handleRevokeDevice,
			logIDWrapper,
			deviceIDWrapper,
			jwtWrapper,
		),
	}
}

func (s *subServer) handleEnrollDevice(
	ctx context.Context,
	request *actormodel.EnrollActorDeviceRequest,
) (*actormodel.EnrollActorDeviceResponse, error) {
	authenticated, err := authenticatedActor(ctx, true)
	if err != nil {
		return nil, err
	}
	httpHandler, err := s.currentHTTPHandler()
	if err != nil {
		return nil, err
	}

	subject := coreauth.GetSubject(ctx)
	type sessionDeviceBinding interface {
		coreauth.SessionDeviceIDResolver
		BindSessionDeviceID(context.Context, string, string) error
	}
	var binding sessionDeviceBinding
	if subject != nil && subject.SessionID != "" {
		var ok bool
		binding, ok = coreauth.GetGlobalSessionValidator().(sessionDeviceBinding)
		if !ok {
			return nil, server.InternalError(
				"session device binding is unavailable",
			)
		}
		persisted := binding.ResolveSessionDeviceID(ctx, subject.SessionID)
		if persisted != "" && persisted != authenticated.DeviceID {
			return nil, server.Forbidden(
				"authenticated session belongs to another device",
			)
		}
	}

	response, err := httpHandler.Enroll(ctx, authenticated, request)
	if err != nil {
		return nil, err
	}
	if binding == nil {
		return response, nil
	}
	if err := binding.BindSessionDeviceID(
		ctx,
		subject.SessionID,
		authenticated.DeviceID,
	); err != nil {
		if errors.Is(err, session.ErrSessionDeviceConflict) {
			return nil, server.Forbidden(
				"authenticated session belongs to another device",
			)
		}
		return nil, server.InternalErrorWithCause(
			"bind authenticated session device",
			err,
		)
	}
	return response, nil
}

func (s *subServer) handleListDevices(
	ctx context.Context,
	request *actormodel.ListActorDevicesRequest,
) (*actormodel.ListActorDevicesResponse, error) {
	authenticated, err := authenticatedActor(ctx, false)
	if err != nil {
		return nil, err
	}
	httpHandler, err := s.currentHTTPHandler()
	if err != nil {
		return nil, err
	}

	return httpHandler.List(ctx, authenticated, request)
}

func (s *subServer) handleRevokeDevice(
	ctx context.Context,
	request *actormodel.RevokeActorDeviceRequest,
) (*actormodel.RevokeActorDeviceResponse, error) {
	authenticated, err := authenticatedActor(ctx, true)
	if err != nil {
		return nil, err
	}
	httpHandler, err := s.currentHTTPHandler()
	if err != nil {
		return nil, err
	}

	return httpHandler.Revoke(ctx, authenticated, request)
}

func authenticatedActor(
	ctx context.Context,
	requireDeviceID bool,
) (actoridentityhttp.AuthenticatedActor, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return actoridentityhttp.AuthenticatedActor{},
			server.Unauthorized("authenticated Actor PTID required")
	}

	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if requireDeviceID && deviceID == "" {
		return actoridentityhttp.AuthenticatedActor{},
			server.Unauthorized("authenticated Actor device required")
	}

	return actoridentityhttp.AuthenticatedActor{
		PTID:     strings.TrimSpace(subject.ID),
		DeviceID: deviceID,
	}, nil
}

func (s *subServer) currentHTTPHandler() (*actoridentityhttp.Handler, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.httpHandler == nil {
		return nil, server.InternalError("Actor Identity subserver is not initialized")
	}

	return s.httpHandler, nil
}

// GetEndpointManifest exposes Actor-owned routing truth to the Federation route owner.
func (s *subServer) GetEndpointManifest(
	ctx context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return nil, err
	}

	return capabilities.GetEndpointManifest(ctx, sourceStationPeerID, request)
}

// ResolveActorHomeStationPeerID exposes the Actor Identity-owned Home Station
// projection to sibling capabilities without exposing its persistence model.
func (s *subServer) ResolveActorHomeStationPeerID(
	ctx context.Context,
	actorPTID string,
) (string, error) {
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return "", err
	}

	return capabilities.ResolveActorHomeStationPeerID(ctx, actorPTID)
}

// ValidateEndpointManifest keeps canonical Actor routing validation behind the
// Actor Identity capability boundary.
func (s *subServer) ValidateEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationPeerID string,
	now time.Time,
) error {
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return err
	}

	return capabilities.ValidateEndpointManifest(
		manifest,
		expectedActorPTID,
		expectedHomeStationPeerID,
		now,
	)
}

// AcceptVerifiedEndpointManifest persists the verified Actor identity
// continuity key and routing fence after Station signature verification.
func (s *subServer) AcceptVerifiedEndpointManifest(
	ctx context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return err
	}

	return capabilities.AcceptVerifiedEndpointManifest(ctx, manifest)
}

// ResolveVerifiedActorDeviceSigningKey resolves identity proof inside the
// Federation receiver's transaction without assigning Actor truth to Conversation.
func (s *subServer) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	expectedHomeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return nil, err
	}

	return capabilities.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		transaction,
		actorPTID,
		expectedHomeStationPeerID,
		deviceID,
		signingKeyID,
	)
}

// ResolveRetainedActorDeviceSigningKey resolves a previously verified key
// without refreshing current remote profile membership.
func (s *subServer) ResolveRetainedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return nil, err
	}

	return capabilities.ResolveRetainedActorDeviceSigningKey(
		ctx,
		transaction,
		actorPTID,
		deviceID,
		signingKeyID,
	)
}

func (s *subServer) currentCapabilities() (*actorCapabilities, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.capabilities == nil {
		return nil, domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.resolve_capability_provider",
			"capability_provider",
			"is not initialized",
		)
	}

	return s.capabilities, nil
}

func signProductionEndpointManifest(
	ctx context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	key, err := authfed.Singleton().Get(ctx)
	if err != nil {
		return domain.WrapError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.load_station_signing_key",
			err,
		)
	}
	if key == nil {
		return domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			"actor_identity.load_station_signing_key",
			"station_signing_key",
			"is unavailable",
		)
	}

	return application.SignEndpointManifest(manifest, key.Kid, key.Priv)
}

func (s *subServer) setStatus(status server.Status) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.status = status
}

var _ server.Subserver = (*subServer)(nil)
