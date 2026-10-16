package relay

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/runtime/role"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const SubserverTypeRelay server.SubserverType = "relay"

var _ server.Subserver = &SubServer{}

type SubServer struct {
	opts   *Options
	status server.Status
	svc    *application.Service

	nodeRotateJWTWrapper   server.Wrapper
	nodeRetireJWTWrapper   server.Wrapper
	routePublishJWTWrapper server.Wrapper
	operatorJWTWrapper     server.Wrapper
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		s.opts.Apply(opt)
	}
	processRole, err := role.FromContext(ctx)
	if err != nil {
		return fmt.Errorf("[relay] resolve runtime role: %w", err)
	}
	if processRole != role.Relay {
		return fmt.Errorf("[relay] subserver cannot initialize under %q role", processRole)
	}
	if s.opts.Admission == nil {
		return fmt.Errorf("[relay] standard Circuit admission is required")
	}
	securityMaterial, err := validateRelaySecurityOptions(s.opts)
	if err != nil {
		return err
	}
	relayIdentity, err := s.opts.Host.Peerstore().
		PrivKey(s.opts.Host.ID()).Raw()
	if err != nil {
		return fmt.Errorf("[relay] read Relay Host identity: %w", err)
	}
	authority, err := application.NewCredentialAuthority(
		relayIdentity,
	)
	if err != nil {
		return fmt.Errorf("[relay] initialize credential authority: %w", err)
	}
	if authority.RelayPeerID() != s.opts.Host.ID().String() {
		return fmt.Errorf(
			"[relay] control identity does not match Circuit Relay PeerID",
		)
	}
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return fmt.Errorf("[relay] get RDS: %w", err)
	}
	repository := infrastructure.NewGormRepo(rds)
	if err := repository.AutoMigrate(); err != nil {
		return fmt.Errorf("[relay] migrate control state: %w", err)
	}
	s.svc = application.NewService(
		repository,
		authority,
		s.opts.Admission,
	)
	if err := s.svc.HydrateAdmission(ctx); err != nil {
		return fmt.Errorf("[relay] hydrate Circuit admission: %w", err)
	}
	s.nodeRotateJWTWrapper = nodeAuthenticationWrapper(
		s.svc,
		domain.ScopeNodeRotate,
	)
	s.nodeRetireJWTWrapper = retireAuthenticationWrapper(s.svc)
	s.routePublishJWTWrapper = nodeAuthenticationWrapper(
		s.svc,
		domain.ScopeRoutePublish,
	)
	s.operatorJWTWrapper = operatorAuthenticationWrapper(
		securityMaterial.operatorKey,
		s.opts.OperatorIssuer,
		s.opts.OperatorAudience,
		s.opts.OperatorScope,
	)
	logger.Infof(ctx, "[relay] standard Circuit control initialized")
	return nil
}

func (s *SubServer) Start(context.Context, ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *SubServer) Stop(context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *SubServer) Name() string                     { return "relay" }
func (s *SubServer) Status() server.Status            { return s.status }
func (s *SubServer) Type() server.SubserverType       { return SubserverTypeRelay }
func (s *SubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

func (s *SubServer) Handlers() []server.Handler {
	return newRelayHandler(s).handlers()
}

func NewRelaySubServer(opts ...option.Option) server.Subserver {
	return &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}
}
