package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

type Option func(*Options)

type Options struct {
	routers map[string]Routers

	coreServer server.Server
	// used for store the options, dont use it directly.
	coreServerOptions []server.Option
}

type routerCtxKey struct{}

func WithRouters(routers Routers) Option {
	return func(o *Options) {
		if o.routers == nil {
			o.routers = make(map[string]Routers)
		}
		o.routers[routers.Name()] = routers
	}
}

func WithCoreServer(s server.Server) Option {
	return func(o *Options) {
		o.coreServer = s
	}
}

func WithServerOptions(opts ...server.Option) Option {
	return func(o *Options) {
		o.coreServerOptions = append(o.coreServerOptions, opts...)
	}
}
