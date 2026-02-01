package launcher

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var (
	_ server.Subserver = (*launcherSubServer)(nil)
)

type launcherSubServer struct {
	opts   *launcherOptions
	addrs  []string
	status server.Status
}

func (s *launcherSubServer) Init(ctx context.Context, opts ...option.Option) error {
	logger.Info(ctx, "begin to initiate new launcher subserver")

	for _, opt := range opts {
		opt(option.GetOptions())
	}

	s.status = server.StatusStarting

	logger.Info(ctx, "end to initiate new launcher subserver")
	return nil
}

func (s *launcherSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	logger.Info(ctx, "launcher subserver started")
	return nil
}

func (s *launcherSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	logger.Info(ctx, "launcher subserver stopped")
	return nil
}

func (s *launcherSubServer) Status() server.Status {
	return s.status
}

func (s *launcherSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

func (s *launcherSubServer) Name() string {
	return "launcher"
}

func (s *launcherSubServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

func (s *launcherSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()

	return []server.Handler{
		server.NewHTTPHandler("launcher-feed", "/launcher/feed", server.GET, server.HTTPHandlerFunc(s.handleGetFeed), logIDWrapper),
		server.NewHTTPHandler("launcher-search", "/launcher/search", server.GET, server.HTTPHandlerFunc(s.handleSearch), logIDWrapper),
	}
}

func New(opts ...option.Option) server.Subserver {
	o := getOptions(opts...)
	s := &launcherSubServer{
		opts:   o,
		addrs:  []string{},
		status: server.StatusStopped,
	}
	return s
}
