package native

import (
	"github.com/peers-touch/peers-touch-go/core/config"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/plugin"
	"github.com/peers-touch/peers-touch-go/core/server"
)

var options struct {
	Peers struct {
		Service struct {
			Server struct {
				Native struct {
					Enabled     bool `pconf:"enabled"`
					EnableDebug bool `pconf:"enable-debug"`
				} `pconf:"native"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type nativeServerPlugin struct {
}

func (n *nativeServerPlugin) Name() string {
	return "native"
}

func (n *nativeServerPlugin) Options() []option.Option {
	var opts []option.Option
	if options.Peers.Service.Server.Native.Enabled {
		// todo append opts
	}

	if options.Peers.Service.Server.Native.EnableDebug {
		// todo append opts
	}

	return opts
}

func (n *nativeServerPlugin) New(opts ...option.Option) server.Server {
	opts = append(opts, n.Options()...)
	return NewServer(opts...)
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServerPlugins["native"] = &nativeServerPlugin{}
}
