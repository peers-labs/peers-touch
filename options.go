package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
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
	Config   config.Config
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

func WithRegistry(r registry.Registry) Option {
	return func(o *Options) {
		o.Registry = r
	}
}
