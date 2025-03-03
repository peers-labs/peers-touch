package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

type routerCtxKey struct{}

func WithRouters(routers ...Routers) server.Option {
	return func(o *server.Options) {
		for _, r := range routers {
			for _, h := range r.Routers() {
				o.Handlers = append(o.Handlers, h)
			}
		}
	}
}
