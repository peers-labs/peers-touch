package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

type Option func(*Options)

type Options struct {
	Name string

	Service  service.Service
	Registry registry.Registry
	Store    store.Store
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

func WithRegistry(r registry.Registry) Option {
	return func(o *Options) {
		o.Registry = r
	}
}
