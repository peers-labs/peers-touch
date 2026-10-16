package bot

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/registry"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/infrastructure"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/infrastructure/persistence"
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
	registry   *registry.Service
}

// NewBotSubServer constructs the owner-scoped IM Bot registry. Message ingress
// is owned by Conversation's generic publishing capability.
func NewBotSubServer(opts ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped, addrs: []string{}}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	repo := persistence.NewGormRepo(rds)
	if err := repo.AutoMigrate(); err != nil {
		return err
	}
	s.registry = registry.NewService(
		repo,
		infrastructure.NewActorMinter(),
		infrastructure.NewLazyPublishingManager(),
		registry.WithProfileChangePublisher(infrastructure.NewProfileChangePublisher()),
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

func (s *subServer) Name() string               { return "bot" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Status() server.Status      { return s.status }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

// Handlers exposes only optional Bot product management. Message ingress is
// owned by Conversation's generic publishing capability.
func (s *subServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewTypedHandler("bot-create", "/bot/create", server.POST, s.handleCreate, s.jwtWrapper),
		server.NewTypedHandler("bot-list", "/bot/list", server.POST, s.handleList, s.jwtWrapper),
		server.NewTypedHandler("bot-rotate-secret", "/bot/rotate-secret", server.POST, s.handleRotateSecret, s.jwtWrapper),
		server.NewTypedHandler("bot-set-state", "/bot/set-state", server.POST, s.handleSetState, s.jwtWrapper),
		server.NewTypedHandler("bot-set-profile", "/bot/set-profile", server.POST, s.handleSetProfile, s.jwtWrapper),
	}
}
