package friend_chat

import (
	"context"
	"sync"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/service"
)

type onlinePeer struct {
	DID       string `json:"did"`
	UpdatedAt int64  `json:"updated_at"`
}

type friendChatSubServer struct {
	status      server.Status
	addrs       []string
	mu          sync.RWMutex
	onlinePeers map[string]onlinePeer
	jwtWrapper  server.Wrapper
	dbName      string

	sessionService service.SessionService
	messageService service.MessageService
	relayService   service.RelayService
}

func (s *friendChatSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	s.onlinePeers = make(map[string]onlinePeer)

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = httpadapter.RequireJWT(provider)

	s.sessionService = service.NewSessionService(s.dbName)
	s.messageService = service.NewMessageService(s.dbName, s.sessionService)
	s.relayService = service.NewRelayService(s.dbName)

	return nil
}

func (s *friendChatSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	go s.cleanupExpiredOfflineMessages(ctx)
	return nil
}

func (s *friendChatSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *friendChatSubServer) Name() string               { return "friend_chat" }
func (s *friendChatSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *friendChatSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *friendChatSubServer) Status() server.Status { return s.status }

func NewFriendChatSubServer(opts ...option.Option) server.Subserver {
	return &friendChatSubServer{
		status: server.StatusStopped,
		addrs:  []string{},
		dbName: "",
	}
}

func (s *friendChatSubServer) cleanupExpiredOfflineMessages(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.relayService.CleanupExpiredMessages(ctx); err != nil {
				logger.DefaultHelper.Errorf("failed to cleanup expired messages: %v", err)
			}
		}
	}
}
