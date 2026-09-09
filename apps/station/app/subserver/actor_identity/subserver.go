package actor_identity

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	actoridentityhttp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/interface/http"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// SubServer owns the canonical actor-device lifecycle routes and persistence.
type SubServer struct {
	mu         sync.RWMutex
	status     server.Status
	handler    *actoridentityhttp.Handler
	jwtWrapper server.Wrapper
}

// NewActorIdentitySubServer constructs the production Actor Identity subserver.
func NewActorIdentitySubServer(_ ...option.Option) server.Subserver {
	return &SubServer{status: server.StatusStopped}
}

// Init composes the actor-owned repository, application service, and HTTP adapter.
func (s *SubServer) Init(ctx context.Context, _ ...option.Option) error {
	s.setStatus(server.StatusStarting)
	database, err := store.GetRDS(ctx)
	if err != nil {
		return s.fail(fmt.Errorf("actor identity: get Station database: %w", err))
	}
	localStationID := strings.TrimSpace(nativefed.LocalIdentitySnapshot().StationPeerID.String())
	if localStationID == "" {
		return s.fail(fmt.Errorf("actor identity: local Station peer identity unavailable"))
	}
	handler, err := compose(database, localStationID, time.Now)
	if err != nil {
		return s.fail(err)
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.handler = handler
	s.jwtWrapper = serverwrapper.CanonicalSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		serverwrapper.SubjectResolver(touchactor.ResolveSubjectPTID),
	)
	return nil
}

func (s *SubServer) Start(context.Context, ...option.Option) error {
	s.setStatus(server.StatusRunning)
	return nil
}

func (s *SubServer) Stop(context.Context) error {
	s.setStatus(server.StatusStopped)
	return nil
}

func (s *SubServer) Name() string                     { return "actor_identity" }
func (s *SubServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *SubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

func (s *SubServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// Handlers registers the sole production owners for the canonical device routes.
func (s *SubServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceID := serverwrapper.DeviceID()
	return []server.Handler{
		server.NewTypedHandler("actor-device-enroll", actoridentityhttp.EnrollPath, server.POST, s.handleEnroll, logID, deviceID, s.jwtWrapper),
		server.NewTypedHandler("actor-device-list", actoridentityhttp.ListPath, server.GET, s.handleList, logID, s.jwtWrapper),
		server.NewTypedHandler("actor-device-revoke", actoridentityhttp.RevokePath, server.POST, s.handleRevoke, logID, s.jwtWrapper),
	}
}

func compose(database *gorm.DB, localStationID string, clock application.Clock) (*actoridentityhttp.Handler, error) {
	repository, err := persistence.NewRepository(database)
	if err != nil {
		return nil, err
	}
	if err := repository.AutoMigrate(); err != nil {
		return nil, err
	}
	service, err := application.NewService(repository, localStationID, clock)
	if err != nil {
		return nil, err
	}
	return actoridentityhttp.NewHandler(service)
}

func (s *SubServer) handleEnroll(ctx context.Context, request *actormodel.EnrollActorDeviceRequest) (*actormodel.EnrollActorDeviceResponse, error) {
	authenticated, err := authenticatedActor(ctx, true)
	if err != nil {
		return nil, err
	}
	return s.handler.Enroll(ctx, authenticated, request)
}

func (s *SubServer) handleList(ctx context.Context, request *actormodel.ListActorDevicesRequest) (*actormodel.ListActorDevicesResponse, error) {
	authenticated, err := authenticatedActor(ctx, false)
	if err != nil {
		return nil, err
	}
	return s.handler.List(ctx, authenticated, request)
}

func (s *SubServer) handleRevoke(ctx context.Context, request *actormodel.RevokeActorDeviceRequest) (*actormodel.RevokeActorDeviceResponse, error) {
	authenticated, err := authenticatedActor(ctx, false)
	if err != nil {
		return nil, err
	}
	return s.handler.Revoke(ctx, authenticated, request)
}

func authenticatedActor(ctx context.Context, requireDevice bool) (actoridentityhttp.AuthenticatedActor, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return actoridentityhttp.AuthenticatedActor{}, server.Unauthorized("authentication required")
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if requireDevice && deviceID == "" {
		return actoridentityhttp.AuthenticatedActor{}, server.BadRequest("X-Device-ID is required")
	}
	return actoridentityhttp.AuthenticatedActor{PTID: subject.ID, DeviceID: deviceID}, nil
}

func (s *SubServer) setStatus(status server.Status) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
}

func (s *SubServer) fail(err error) error {
	s.setStatus(server.StatusError)
	return err
}

var _ server.Subserver = (*SubServer)(nil)
