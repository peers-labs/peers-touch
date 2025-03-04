package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/server"
)

type Option func(*Options)

type Options struct {
	Name string

	Service  service.Service
	Server   server.Server
	Registry registry.Registry
	Store    store.Store
	Config   config.Config
}

// ServiceOptions helps to convert the options of service
// calling this should confirm the Init aready done.
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

func WithCore(s service.Service) Option {
	return func(o *Options) {
		o.Service = s
	}
}

func WithStore(s store.Store) Option {
	return func(o *Options) {
		o.Store = s
	}
}

func WithConfig(c config.Config) Option {
	return func(o *Options) {
		o.Config = c
	}
}

func WithServer(s server.Server) Option {
	return func(o *Options) {
		o.Server = s
	}
}

func WithRegistry(r registry.Registry) Option {
	return func(o *Options) {
		o.Registry = r
	}
}
