package native

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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

// Name returns the plugin identifier.
func (n *nativeServerPlugin) Name() string {
	return "native"
}

// Options returns server options provided by the plugin.
func (n *nativeServerPlugin) Options() []option.Option {
	var opts []option.Option

	return opts
}

// New constructs a new native server with plugin options.
func (n *nativeServerPlugin) New(opts ...option.Option) server.Server {
	opts = append(opts, n.Options()...)
	return NewServer(opts...)
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServerPlugins["native"] = &nativeServerPlugin{}
}
