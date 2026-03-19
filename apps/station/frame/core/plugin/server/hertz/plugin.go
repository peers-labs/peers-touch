package hertz

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
				Hertz struct {
					Enabled bool `pconf:"enabled"`
				} `pconf:"native"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

// hertzServerPlugin wires config to build a hertz server.
type hertzServerPlugin struct{}

// Name returns the plugin identifier.
func (n *hertzServerPlugin) Name() string {
	return "hertz"
}

// Options returns server options derived from configuration.
func (n *hertzServerPlugin) Options() []option.Option {
	var opts []option.Option
	if options.Peers.Service.Server.Hertz.Enabled {
		// todo append opts
	}

	return opts
}

// New constructs a hertz server with plugin options.
func (n *hertzServerPlugin) New(opts ...option.Option) server.Server {
	opts = append(opts, n.Options()...)
	return NewServer(opts...)
}

func init() {
	config.RegisterOptions(&options)
	pl := &hertzServerPlugin{}
	plugin.ServerPlugins[pl.Name()] = &hertzServerPlugin{}
}
