package group_chat

import (
	"context"
	"time"

	application_group_chat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat/application"
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
	service    *service
	appService *application_group_chat.Service
}

func NewGroupChatSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
		service: &service{
			groups:       map[string]*group{},
			messages:     map[string][]message{},
			messagesByID: map[string]message{},
			members:      map[string]map[string]*member{},
			invitations:  map[string]*invitation{},
			settings:     map[string]map[string]groupSetting{},
			offline:      map[string][]offlineMessage{},
			unread:       map[string]map[string]int64{},
		},
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
	if err := rds.AutoMigrate(
		&groupModel{},
		&memberModel{},
		&messageModel{},
		&MessageAttachmentModel{},
		&outboxModel{},
		&invitationModel{},
		&settingModel{},
		&offlineModel{},
	); err != nil {
		return err
	}
	s.service.db = rds
	if err := s.service.bootstrapFromDB(); err != nil {
		return err
	}
	s.appService = application_group_chat.NewService(s.service)
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.service.dispatchOutbox()
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

func (s *subServer) Name() string               { return "group_chat" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
