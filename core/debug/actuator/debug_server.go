package actuator

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/node"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

var (
	_ server.Subserver = (*debugSubServer)(nil)
)

// debugRouterURL implements server.RouterURL for debug endpoints
type debugRouterURL struct {
	name string
	url  string
}

func (d debugRouterURL) Name() string {
	return d.name
}

func (d debugRouterURL) SubPath() string {
	return d.url
}

type debugSubServer struct {
	opts *DebugServerOptions
}

func NewDebugSubServer(opts ...option.Option) server.Subserver {
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
		logger.Warn(ctx, "debug server registry is nil, trying to get from node")
		d.opts.registry = node.GetOptions(d.opts.Options).Registry
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

func (d *debugSubServer) Address() server.SubserverAddress {
	// todo implement me
	return server.SubserverAddress{}
}

func (d *debugSubServer) Status() server.Status {
	//TODO implement me
	panic("implement me")
}

func (d *debugSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			debugRouterURL{name: "debugListRegisteredPeers", url: "/debug/registered-peers"},
			func(c context.Context, ctx *app.RequestContext) {
				peers, err := d.opts.registry.ListPeers(c)
				if err != nil {
					ctx.String(http.StatusInternalServerError, fmt.Sprintf("Error getting registered peers: %v", err))
					return
				}

				ctx.JSON(http.StatusOK, map[string]interface{}{
					"count": len(peers),
					"peers": peers,
				})
			},
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			debugRouterURL{name: "debugListAllHandlers", url: "/debug/list-all-handlers"},
			func(c context.Context, ctx *app.RequestContext) {
				handlers := server.GetOptions().Handlers
				type handlerStruct struct {
					Name   string
					Path   string
					Method string
				}
				handlersList := make([]handlerStruct, 0)
				for _, h := range handlers {
					handlersList = append(handlersList, handlerStruct{
						Name:   h.Name(),
						Path:   h.Path(),
						Method: string(h.Method()),
						// todo params
					})
				}

				ctx.JSON(http.StatusOK, map[string]interface{}{
					"count":    len(handlers),
					"handlers": handlersList,
				})
			}, server.WithMethod(server.GET),
		),
		server.NewHandler(
			debugRouterURL{name: "debugGetPeerByID", url: "/debug/get-peer-by-id"},
			func(c context.Context, ctx *app.RequestContext) {
				id := ctx.Query("id")
				if id == "" {
					ctx.String(http.StatusBadRequest, "id is required")
					return
				}

				peers, err := d.opts.registry.GetPeer(c, registry.WithId(id))
				if err != nil {
					ctx.String(http.StatusInternalServerError, fmt.Sprintf("Error getting peer: %v", err))
					return
				}

				ctx.JSON(http.StatusOK, map[string]interface{}{
					"data": peers,
				})
			},
			server.WithMethod(server.GET),
		),
	}
}

func (d *debugSubServer) Type() server.SubserverType {
	return server.SubserverTypeDebug
}
