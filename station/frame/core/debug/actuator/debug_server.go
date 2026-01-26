// Package actuator provides a simple debug server for health and introspection.
package actuator

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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

// debugSubServer implements a lightweight debug Subserver.
type debugSubServer struct {
	opts *DebugServerOptions
}

// NewDebugSubServer constructs a debug subserver.
func NewDebugSubServer(opts ...option.Option) server.Subserver {
	s := &debugSubServer{
		opts: option.GetOptions(opts...).Ctx().Value(debugServerOptionsKey{}).(*DebugServerOptions),
	}
	return s
}

// Init loads options and resolves registry dependency.
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

// Start starts the debug subserver (no-op for now).
func (d *debugSubServer) Start(ctx context.Context, opts ...option.Option) error {
	return nil
}

// Stop stops the debug subserver (no-op for now).
func (d *debugSubServer) Stop(ctx context.Context) error {
	return nil
}

// Name returns subserver identifier.
func (d *debugSubServer) Name() string {
	return "peers-debug-server"
}

// Address returns the debug server address.
func (d *debugSubServer) Address() server.SubserverAddress {
	// todo implement me
	return server.SubserverAddress{}
}

// Status returns current status (not tracked).
func (d *debugSubServer) Status() server.Status {
	return server.StatusRunning
}

// Handlers returns debug endpoints.
func (d *debugSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler("debugListRegisteredPeers", "/debug/registered-peers", server.GET,
			server.HertzHandlerFunc(func(c context.Context, ctx *app.RequestContext) {
				peers, err := d.opts.registry.Query(c)
				if err != nil {
					ctx.String(http.StatusInternalServerError, fmt.Sprintf("Error getting registered peers: %v", err))
					return
				}

				ctx.JSON(http.StatusOK, map[string]interface{}{
					"count": len(peers),
					"peers": peers,
				})
			}),
		),
		server.NewHTTPHandler("debugListAllHandlers", "/debug/list-all-handlers", server.GET,
			server.HertzHandlerFunc(func(c context.Context, ctx *app.RequestContext) {
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
					})
				}

				ctx.JSON(http.StatusOK, map[string]interface{}{
					"count":    len(handlers),
					"handlers": handlersList,
				})
			}),
		),
		server.NewHTTPHandler("debugGetPeerByID", "/debug/get-peer-by-id", server.GET,
			server.HertzHandlerFunc(func(c context.Context, ctx *app.RequestContext) {
				id := ctx.Query("id")
				if id == "" {
					ctx.String(http.StatusBadRequest, "id is required")
					return
				}

				peers, err := d.opts.registry.Query(c, registry.WithID(id))
				if err != nil {
					ctx.String(http.StatusInternalServerError, fmt.Sprintf("Error getting peer: %v", err))
					return
				}

				if len(peers) == 0 {
					ctx.String(http.StatusNotFound, "peer not found")
					return
				}

				ctx.JSON(http.StatusOK, map[string]interface{}{
					"data": peers[0],
				})
			}),
		),
	}
}

func (d *debugSubServer) Type() server.SubserverType {
	return server.SubserverTypeDebug
}
