package notification

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type subServer struct {
	status     server.Status
	addrs      []string
	jwtWrapper server.Wrapper
	service    *application.Service
	repo       *infrastructure.GormRepo
}

func NewNotificationSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	repo := infrastructure.NewGormRepo(rds)
	if err := repo.AutoMigrate(); err != nil {
		return err
	}
	protector, err := infrastructure.NewPushCredentialProtector(coreauth.Get().Secret)
	if err != nil {
		return err
	}
	if err := repo.ActivatePushCredentialKey(
		protector.KeyVersion(),
		protector.KeyIdentity(),
	); err != nil {
		return err
	}

	s.repo = repo
	s.service = application.NewService(repo, protector)

	RegisterService(s.service)

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

func (s *subServer) Name() string               { return "notification" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Status() server.Status      { return s.status }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

// GetService exposes the notification service for cross-SubServer use.
// Other SubServers (e.g. friend_chat) call this to produce notifications.
func (s *subServer) GetService() *application.Service {
	return s.service
}
