package cmd

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/transport"
)

type Options struct {
	// For the Command Line itself
	Name        string
	Description string
	Version     string

	// We need pointers to things so we can swap them out if needed.
	Registry  *registry.Registry
	Transport *transport.Transport
	Client    *client.Client
	Server    *server.Server

	Clients    map[string]func(...client.Option) client.Client
	Registries map[string]func(...registry.Option) registry.Registry
	Servers    map[string]func(...server.Option) server.Server

	// Other options for implementations of the interface
	// can be stored in a context
	Context context.Context
}

func Name(n string) Option {
	return func(o *Options) {
		o.Name = n
	}
}

func Description(d string) Option {
	return func(o *Options) {
		o.Description = d
	}
}

func Version(v string) Option {
	return func(o *Options) {
		o.Version = v
	}
}

func Registry(r *registry.Registry) Option {
	return func(o *Options) {
		o.Registry = r
	}
}

func Transport(t *transport.Transport) Option {
	return func(o *Options) {
		o.Transport = t
	}
}

func Client(c *client.Client) Option {
	return func(o *Options) {
		o.Client = c
	}
}

func Server(s *server.Server) Option {
	return func(o *Options) {
		o.Server = s
	}
}

func NewClient(name string, b func(...client.Option) client.Client) Option {
	return func(o *Options) {
		o.Clients[name] = b
	}
}

func NewRegistry(name string, r func(...registry.Option) registry.Registry) Option {
	return func(o *Options) {
		o.Registries[name] = r
	}
}

func NewServer(name string, s func(...server.Option) server.Server) Option {
	return func(o *Options) {
		o.Servers[name] = s
	}
}
