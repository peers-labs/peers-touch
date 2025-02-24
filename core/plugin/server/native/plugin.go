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
			Name    string `pconf:"name"`
			Address string `pconf:"address"`
			Timeout int    `pconf:"timeout"`
			Server  struct {
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
	// todo real options
	return []server.Option{}
}

func (n *nativeServerPlugin) New(opts ...server.Option) server.Server {
	opts = append(opts, n.Options()...)
	return NewServer(opts...)
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServerPlugins["native"] = &nativeServerPlugin{}
}
