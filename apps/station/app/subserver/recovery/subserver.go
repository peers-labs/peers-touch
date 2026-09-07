package recovery

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application"
	recoverydomain "github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/infrastructure/persistence"
	recoveryhttp "github.com/peers-labs/peers-touch/station/app/subserver/recovery/interface/http"
	recoverymodel "github.com/peers-labs/peers-touch/station/app/subserver/recovery/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"gorm.io/gorm"
)

const (
	storeRecoveryRevisionPath = "/recovery/revision"
	readLatestRecoveryPath    = "/recovery/latest"
	maxEncryptedArchiveBytes  = 256 << 20
)

type systemClock struct{}

func (systemClock) Now() time.Time {
	return time.Now().UTC()
}

// SubServer owns canonical opaque Recovery persistence and HTTP routes.
type SubServer struct {
	mu         sync.RWMutex
	status     server.Status
	contract   *recoveryhttp.ContractAdapter
	jwtWrapper server.Wrapper
}

// NewRecoverySubServer constructs the production Recovery subserver.
func NewRecoverySubServer(_ ...option.Option) server.Subserver {
	return &SubServer{status: server.StatusStopped}
}

// Init composes Recovery over its canonical store and Actor-owned authorization.
func (s *SubServer) Init(ctx context.Context, _ ...option.Option) error {
	s.setStatus(server.StatusStarting)
	database, err := store.GetRDS(ctx)
	if err != nil {
		return s.fail(fmt.Errorf("recovery: get Station database: %w", err))
	}
	contract, err := compose(database, maxEncryptedArchiveBytes)
	if err != nil {
		return s.fail(err)
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.contract = contract
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

func (s *SubServer) Name() string                     { return "recovery" }
func (s *SubServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *SubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

func (s *SubServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// Handlers registers the sole production owners for opaque Recovery revisions.
func (s *SubServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceID := serverwrapper.DeviceID()
	return []server.Handler{
		server.NewTypedHandler(
			"recovery-revision-store",
			storeRecoveryRevisionPath,
			server.POST,
			s.handleStoreRecoveryRevision,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"recovery-revision-latest",
			readLatestRecoveryPath,
			server.GET,
			s.handleReadLatestRecoveryRevision,
			logID,
			s.jwtWrapper,
		),
	}
}

func compose(database *gorm.DB, maximumArchiveBytes int) (*recoveryhttp.ContractAdapter, error) {
	repository, err := persistence.NewRepository(database)
	if err != nil {
		return nil, err
	}
	if err := repository.Migrate(context.Background()); err != nil {
		return nil, err
	}
	service, err := application.NewService(
		repository,
		persistence.NewActorDeviceAuthorizer(database),
		systemClock{},
		maximumArchiveBytes,
	)
	if err != nil {
		return nil, err
	}
	return recoveryhttp.NewContractAdapter(service)
}

func (s *SubServer) handleStoreRecoveryRevision(
	ctx context.Context,
	request *recoverymodel.StoreRecoveryRevisionRequest,
) (*recoverymodel.StoreRecoveryRevisionResponse, error) {
	authenticated, err := authenticatedActorDevice(ctx, true)
	if err != nil {
		return nil, err
	}
	response, err := s.contract.StoreRecoveryRevision(ctx, authenticated, request)
	return response, mapRecoveryError(err)
}

func (s *SubServer) handleReadLatestRecoveryRevision(
	ctx context.Context,
	request *recoverymodel.ReadLatestRecoveryRevisionRequest,
) (*recoverymodel.ReadLatestRecoveryRevisionResponse, error) {
	authenticated, err := authenticatedActorDevice(ctx, false)
	if err != nil {
		return nil, err
	}
	response, err := s.contract.ReadLatestRecoveryRevision(ctx, authenticated, request)
	return response, mapRecoveryError(err)
}

func authenticatedActorDevice(
	ctx context.Context,
	requireDevice bool,
) (recoveryhttp.AuthenticatedActorDevice, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return recoveryhttp.AuthenticatedActorDevice{},
			server.Unauthorized("authentication required")
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if requireDevice && deviceID == "" {
		return recoveryhttp.AuthenticatedActorDevice{},
			server.BadRequest("X-Device-ID is required")
	}
	return recoveryhttp.AuthenticatedActorDevice{
		PTID:     subject.ID,
		DeviceID: deviceID,
	}, nil
}

func mapRecoveryError(err error) error {
	if err == nil {
		return nil
	}
	var typed *recoverydomain.Error
	if !errors.As(err, &typed) {
		return server.InternalErrorWithCause("recovery operation failed", err)
	}
	message := fmt.Sprintf("[%s] recovery operation failed", typed.Code)
	switch typed.Code {
	case recoverydomain.ErrorCodeInvalidArgument,
		recoverydomain.ErrorCodeArchiveIntegrity,
		recoverydomain.ErrorCodeArchiveTooLarge:
		return server.NewHandlerErrorWithCause(http.StatusBadRequest, message, err)
	case recoverydomain.ErrorCodeUnauthorized:
		return server.NewHandlerErrorWithCause(http.StatusForbidden, message, err)
	case recoverydomain.ErrorCodeRevisionNotFound:
		return server.NewHandlerErrorWithCause(http.StatusNotFound, message, err)
	case recoverydomain.ErrorCodeRevisionConflict:
		return server.NewHandlerErrorWithCause(http.StatusConflict, message, err)
	default:
		return server.NewHandlerErrorWithCause(http.StatusInternalServerError, message, err)
	}
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
