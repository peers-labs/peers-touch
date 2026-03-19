package group_chat

import (
	"context"
	"sync"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/service"
)

type groupChatSubServer struct {
	status     server.Status
	addrs      []string
	mu         sync.RWMutex
	jwtWrapper server.Wrapper
	dbName     string

	groupService   service.GroupService
	memberService  service.MemberService
	messageService service.MessageService
}

func (s *groupChatSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	s.groupService = service.NewGroupService(s.dbName)
	s.memberService = service.NewMemberService(s.dbName)
	s.messageService = service.NewMessageService(s.dbName)

	return nil
}

func (s *groupChatSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	go s.cleanupExpiredInvitations(ctx)
	return nil
}

func (s *groupChatSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *groupChatSubServer) Name() string               { return "group_chat" }
func (s *groupChatSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *groupChatSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *groupChatSubServer) Status() server.Status { return s.status }

func NewGroupChatSubServer(opts ...option.Option) server.Subserver {
	return &groupChatSubServer{
		status: server.StatusStopped,
		addrs:  []string{},
		dbName: "",
	}
}

func (s *groupChatSubServer) cleanupExpiredInvitations(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.groupService.CleanupExpiredInvitations(ctx); err != nil {
				logger.DefaultHelper.Errorf("failed to cleanup expired invitations: %v", err)
			}
		}
	}
}
