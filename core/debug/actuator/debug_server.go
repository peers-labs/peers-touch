package actuator

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

var (
	_ server.SubServer = (*debugSubServer)(nil)
)

type debugSubServer struct {
	opts *DebugServerOptions
}

func NewDebugSubServer(opts ...option.Option) server.SubServer {
	s := &debugSubServer{
		opts: option.GetOptions(opts...).Ctx().Value(debugServerOptionsKey{}).(*DebugServerOptions),
	}
	return s
}

func (d *debugSubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, o := range opts {
		d.opts.Apply(o)
	}

	if d.opts.registry == nil {
		logger.Warn(ctx, "debug server registry is nil, trying to get from service")
		d.opts.registry = service.GetOptions(d.opts.Options).Registry
	}

	return nil
}

func (d *debugSubServer) Start(ctx context.Context, opts ...option.Option) error {
	return nil
}

func (d *debugSubServer) Stop(ctx context.Context) error {
	return nil
}

func (d *debugSubServer) Name() string {
	return "peers-debug-server"
}

func (d *debugSubServer) Port() int {
	// todo implement me
	return 0
}

func (d *debugSubServer) Status() server.ServerStatus {
	//TODO implement me
	panic("implement me")
}

func (d *debugSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			"debugListRegisteredPeers",
			"/debug/registered_peers",
			func(c context.Context, ctx *app.RequestContext) {
				peers, err := d.opts.registry.GetPeer(c, ctx.GetString("name"))
				if err != nil {
					ctx.String(http.StatusInternalServerError, fmt.Sprintf("Error getting registered peers: %v", err))
					return
				}
				ctx.String(http.StatusOK, fmt.Sprintf("Registered peers: %v", peers))
			},
		),
	}
}
