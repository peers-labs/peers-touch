package friend_chat

import (
	"context"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/infrastructure"
	notifbridge "github.com/peers-labs/peers-touch/station/app/subserver/notification"
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
	mu         sync.RWMutex
	pending    map[string][]pendingMessage
}

type pendingMessage struct {
	ULID             string
	SenderDID        string
	SessionULID      string
	EncryptedPayload []byte
	CreatedAt        int64
}

func NewFriendChatSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	_ = ctx
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
	s.service = application.NewService(repo)
	s.pending = make(map[string][]pendingMessage)
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	// Wire notification bridge during Start() — notification SubServer is initialized by now.
	s.service.SetNotifier(notifbridge.NewBridge())
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if s.repo != nil {
					_, _ = s.repo.DispatchOutbox(100)
				}
			}
		}
	}()
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	_ = ctx
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "friend_chat" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
