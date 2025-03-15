package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

type Option func(*Options)

type Options struct {
	Name string

	serviceOpts service.Options
}

// ServiceOptions helps to convert the options of service
// calling this should confirm the Init already done.
func (o *Options) ServiceOptions() (ret []service.Option) {
	if len(o.Name) > 0 {
		ret = append(ret, service.Name(o.Name))
	}

	return
}

func WithName(name string) Option {
	return func(o *Options) {
		o.Name = name
	}
}

func WithAppendHandlers(handlers ...server.Handler) Option {
	return func(o *Options) {
		o.serviceOpts.ServerOptions = append(o.serviceOpts.ServerOptions, server.WithHandlers(handlers...))
	}
}

func WithSubServer(srv server.SubServer, opts ...server.SubServerOption) Option {
	return func(o *Options) {
		o.serviceOpts.ServerOptions = append(o.serviceOpts.ServerOptions, server.WithSubServer(srv, opts...))
	}
}
