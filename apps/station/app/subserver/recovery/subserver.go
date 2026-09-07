package recovery

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/infrastructure/persistence"
	recoveryhttp "github.com/peers-labs/peers-touch/station/app/subserver/recovery/interface/http"
	recoverymodel "github.com/peers-labs/peers-touch/station/app/subserver/recovery/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"gorm.io/gorm"
)

const (
	storeRecoveryRevisionPath          = "/recovery/revision"
	readLatestRecoveryRevisionPath     = "/recovery/latest"
	defaultMaxEncryptedRecoveryArchive = 256 << 20
)

type systemClock struct{}

func (systemClock) Now() time.Time {
	return time.Now()
}

type subServerDependencies struct {
	database                 func(context.Context) (*gorm.DB, error)
	authorizer               func(*gorm.DB) (ports.ActorDeviceAuthorizer, error)
	authProvider             func() coreauth.Provider
	subjectResolver          serverwrapper.SubjectResolver
	clock                    ports.Clock
	maxEncryptedArchiveBytes int
}

type subServer struct {
	mu sync.RWMutex

	status       server.Status
	addrs        []string
	dependencies subServerDependencies
	repository   *persistence.Repository
	service      *application.Service
	contract     *recoveryhttp.ContractAdapter
	jwtWrapper   server.Wrapper
}

// NewRecoverySubServer constructs the production Recovery HTTP subserver.
func NewRecoverySubServer(_ ...option.Option) server.Subserver {
	return newRecoverySubServer(productionSubServerDependencies())
}

func newRecoverySubServer(dependencies subServerDependencies) *subServer {
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
		authorizer: func(database *gorm.DB) (ports.ActorDeviceAuthorizer, error) {
			return persistence.NewActorDeviceAuthorizer(database)
		},
		authProvider:             newRecoveryAuthProvider,
		subjectResolver:          touchactor.ResolveSubjectPTID,
		clock:                    systemClock{},
		maxEncryptedArchiveBytes: defaultMaxEncryptedRecoveryArchive,
	}
}

func newRecoveryAuthProvider() coreauth.Provider {
	config := coreauth.Get()

	return coreauth.NewJWTProvider(config.Secret, config.AccessTTL)
}

// Init composes the canonical persistence, application, HTTP, and auth layers.
func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	if err := s.beginInitialization(); err != nil {
		logger.Errorf(ctx, "recovery subserver initialization rejected: %v", err)

		return err
	}

	if err := s.initialize(ctx); err != nil {
		s.setStatus(server.StatusError)
		logger.Errorf(ctx, "recovery subserver initialization failed: %v", err)

		return err
	}

	logger.Info(ctx, "recovery subserver initialized")

	return nil
}

func (s *subServer) beginInitialization() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status != server.StatusStopped {
		return fmt.Errorf(
			"recovery subserver initialization requires stopped status, got %s",
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

	database, err := s.dependencies.database(ctx)
	if err != nil {
		return fmt.Errorf("open Recovery database: %w", err)
	}
	repository, err := persistence.NewRepository(database)
	if err != nil {
		return fmt.Errorf("construct Recovery repository: %w", err)
	}
	if err := repository.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate Recovery schema: %w", err)
	}
	authorizer, err := s.dependencies.authorizer(database)
	if err != nil {
		return fmt.Errorf("construct Recovery actor-device authorizer: %w", err)
	}
	service, err := application.NewService(
		repository,
		authorizer,
		s.dependencies.clock,
		s.dependencies.maxEncryptedArchiveBytes,
	)
	if err != nil {
		return fmt.Errorf("construct Recovery application service: %w", err)
	}
	contract, err := recoveryhttp.NewContractAdapter(service)
	if err != nil {
		return fmt.Errorf("construct Recovery HTTP adapter: %w", err)
	}
	provider := s.dependencies.authProvider()
	if provider == nil {
		return fmt.Errorf("construct Recovery auth provider: provider is required")
	}
	jwtWrapper := serverwrapper.CanonicalSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		s.dependencies.subjectResolver,
	)

	s.mu.Lock()
	s.repository = repository
	s.service = service
	s.contract = contract
	s.jwtWrapper = jwtWrapper
	s.mu.Unlock()

	return nil
}

func validateSubServerDependencies(dependencies subServerDependencies) error {
	switch {
	case dependencies.database == nil:
		return fmt.Errorf("recovery database provider is required")
	case dependencies.authorizer == nil:
		return fmt.Errorf("recovery actor-device authorizer provider is required")
	case dependencies.authProvider == nil:
		return fmt.Errorf("recovery auth provider is required")
	case dependencies.subjectResolver == nil:
		return fmt.Errorf("recovery subject resolver is required")
	case dependencies.clock == nil:
		return fmt.Errorf("recovery clock is required")
	case dependencies.maxEncryptedArchiveBytes <= 0:
		return fmt.Errorf("recovery encrypted archive byte limit must be positive")
	default:
		return nil
	}
}

// Start transitions an initialized Recovery subserver into running state.
func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	if s.status != server.StatusStarting || s.contract == nil || s.jwtWrapper == nil {
		currentStatus := s.status
		s.status = server.StatusError
		s.mu.Unlock()

		err := fmt.Errorf(
			"recovery subserver start requires initialized status, got %s",
			currentStatus,
		)
		logger.Errorf(ctx, "recovery subserver start failed: %v", err)

		return err
	}
	s.status = server.StatusRunning
	s.mu.Unlock()

	logger.Info(ctx, "recovery subserver started")

	return nil
}

// Stop transitions Recovery to stopped without closing the shared Station store.
func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	if s.status == server.StatusStopped {
		s.mu.Unlock()

		return nil
	}
	s.status = server.StatusStopping
	s.status = server.StatusStopped
	s.mu.Unlock()

	logger.Info(ctx, "recovery subserver stopped")

	return nil
}

// Name returns the stable Recovery runtime name.
func (s *subServer) Name() string {
	return "recovery"
}

// Type identifies Recovery as an HTTP subserver.
func (s *subServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address reports that Recovery is mounted on the parent Station listener.
func (s *subServer) Address() server.SubserverAddress {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return server.SubserverAddress{
		Address: append([]string(nil), s.addrs...),
	}
}

// Status returns the current Recovery lifecycle state.
func (s *subServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.status
}

// Handlers registers only the canonical Recovery resource routes.
func (s *subServer) Handlers() []server.Handler {
	s.mu.RLock()
	contract := s.contract
	jwtWrapper := s.jwtWrapper
	s.mu.RUnlock()
	if contract == nil || jwtWrapper == nil {
		return nil
	}

	logIDWrapper := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()

	return []server.Handler{
		server.NewTypedHandler(
			"recovery-revision-put",
			storeRecoveryRevisionPath,
			server.POST,
			s.handleStoreRecoveryRevision,
			logIDWrapper,
			deviceIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"recovery-revision-latest",
			readLatestRecoveryRevisionPath,
			server.GET,
			s.handleReadLatestRecoveryRevision,
			logIDWrapper,
			jwtWrapper,
		),
	}
}

func (s *subServer) handleStoreRecoveryRevision(
	ctx context.Context,
	request *recoverymodel.StoreRecoveryRevisionRequest,
) (*recoverymodel.StoreRecoveryRevisionResponse, error) {
	authenticated, err := authenticatedRecoveryActor(ctx, true)
	if err != nil {
		return nil, err
	}
	contract, err := s.currentContract()
	if err != nil {
		return nil, err
	}

	response, err := contract.StoreRecoveryRevision(ctx, authenticated, request)
	if err != nil {
		logger.Warnf(ctx, "store Recovery revision failed: %v", err)
	}
	return response, recoveryhttp.MapError(err)
}

func (s *subServer) handleReadLatestRecoveryRevision(
	ctx context.Context,
	request *recoverymodel.ReadLatestRecoveryRevisionRequest,
) (*recoverymodel.ReadLatestRecoveryRevisionResponse, error) {
	authenticated, err := authenticatedRecoveryActor(ctx, false)
	if err != nil {
		return nil, err
	}
	contract, err := s.currentContract()
	if err != nil {
		return nil, err
	}

	response, err := contract.ReadLatestRecoveryRevision(ctx, authenticated, request)
	if err != nil {
		logger.Warnf(ctx, "read latest Recovery revision failed: %v", err)
	}
	return response, recoveryhttp.MapError(err)
}

func authenticatedRecoveryActor(
	ctx context.Context,
	requireDeviceID bool,
) (recoveryhttp.AuthenticatedActorDevice, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return recoveryhttp.AuthenticatedActorDevice{},
			server.Unauthorized("authenticated Recovery actor required")
	}

	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if requireDeviceID && deviceID == "" {
		return recoveryhttp.AuthenticatedActorDevice{},
			server.Unauthorized("authenticated Recovery device required")
	}

	return recoveryhttp.AuthenticatedActorDevice{
		PTID:     strings.TrimSpace(subject.ID),
		DeviceID: deviceID,
	}, nil
}

func (s *subServer) currentContract() (*recoveryhttp.ContractAdapter, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.contract == nil {
		return nil, server.InternalError("Recovery subserver is not initialized")
	}

	return s.contract, nil
}

func (s *subServer) setStatus(status server.Status) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.status = status
}

var _ server.Subserver = (*subServer)(nil)
