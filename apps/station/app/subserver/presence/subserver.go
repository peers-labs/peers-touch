package presence

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/presence/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const expireSweepInterval = 10 * time.Second

type subServer struct {
	status     server.Status
	addrs      []string
	jwtWrapper server.Wrapper
	repo       *infrastructure.GormRepo
	service    *application.Service
	cancel     context.CancelFunc
}

func NewPresenceSubServer(opts ...option.Option) server.Subserver {
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
	s.repo = repo
	s.service = application.NewService(repo, eventBusPublisher{})
	setGlobalService(s.service)
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	workerCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	go s.runExpiryWorker(workerCtx)
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	setGlobalService(nil)
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "presence" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }

func (s *subServer) runExpiryWorker(ctx context.Context) {
	ticker := time.NewTicker(expireSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.service.Expire(); err != nil {
				logger.DefaultHelper.Warnf("presence: expire sweep failed: %v", err)
			}
		}
	}
}
