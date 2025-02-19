package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/server"
)

type Option func(*Options)

type Options struct {
	Name string

	Client   client.Client
	Server   server.Server
	Registry registry.Registry
	Store    store.Store
}

func WithName(name string) Option {
	return func(o *Options) {
		o.Name = name
	}
}

func WithServer(s server.Server) Option {
	return func(o *Options) {
		o.Server = s
	}
}

func WithStore(s store.Store) Option {
	return func(o *Options) {
		o.Store = s
	}
}

func WithRegistry(r registry.Registry) Option {
	return func(o *Options) {
		o.Registry = r
	}
}
