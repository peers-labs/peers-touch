package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/client"
	"github.com/dirty-bro-tech/peers-touch-go/server"
)

type Option func(*Options)

type Options struct {
	Name string

	Client client.Client
	Server server.Server
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
