package app_meta

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type subServer struct {
	status server.Status
	addrs  []string
}

func NewAppMetaSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
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

func (s *subServer) Name() string               { return "app_meta" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
