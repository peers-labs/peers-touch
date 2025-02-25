package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

/**
peers:
	service:
		server:
			name: native
			address: 0.0.0.0:8080
			timeout: 1s
			native:

*/

var options struct {
	Peers struct {
		Service struct {
			Name string `pconf:"name"`
			// todo move the common config to peers-touch-go/core/server
			Server struct {
				Address  string            `pconf:"address"` // Server address
				Timeout  int               `pconf:"timout"`  // Server timeout
				Metadata map[string]string `pconf:"metadata"`
				Native   struct {
					Enabled bool `pconf:"enabled"`
				} `pconf:"native"`
			} `pconf:"server"`
		} `pconf:"service"`
	} `pconf:"peers"`
}

type nativeServerPlugin struct {
}

func (n *nativeServerPlugin) Name() string {
	return "native"
}

func (n *nativeServerPlugin) Options() []server.Option {
	var opts []server.Option
	if options.Peers.Service.Server.Native.Enabled {
		opts = append(opts,
			server.WithAddress(options.Peers.Service.Server.Address),
			server.WithTimeout(options.Peers.Service.Server.Timeout))
	}

	return opts
}

func (n *nativeServerPlugin) New(opts ...server.Option) server.Server {
	opts = append(opts, n.Options()...)
	return NewServer(opts...)
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServerPlugins["native"] = &nativeServerPlugin{}
}
