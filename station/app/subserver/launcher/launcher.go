package launcher

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var (
	_ server.Subserver = (*launcherSubServer)(nil)
)

type launcherURL struct {
	name string
	path string
}

func (u launcherURL) Name() string    { return u.name }
func (u launcherURL) Path() string    { return u.path }
func (u launcherURL) SubPath() string { return u.path }

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
	return []server.Handler{
		server.NewHandler(
			launcherURL{name: "launcher-feed", path: "/api/launcher/feed"},
			http.HandlerFunc(s.handleGetFeedHTTP),
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			launcherURL{name: "launcher-search", path: "/api/launcher/search"},
			http.HandlerFunc(s.handleSearchHTTP),
			server.WithMethod(server.GET),
		),
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
