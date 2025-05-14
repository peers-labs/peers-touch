package hertz

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

var options struct {
	Peers struct {
		Service struct {
			Server struct {
				Hertz struct {
					Enabled bool `pconf:"enabled"`
				} `pconf:"native"`
			} `pconf:"server"`
		} `pconf:"service"`
	} `pconf:"peers"`
}

type hertzServerPlugin struct {
}

func (n *hertzServerPlugin) Name() string {
	return "hertz"
}

func (n *hertzServerPlugin) Options() []*option.Option {
	var opts []*option.Option
	if options.Peers.Service.Server.Hertz.Enabled {
		// todo append opts
	}

	return opts
}

func (n *hertzServerPlugin) New(opts ...*option.Option) server.Server {
	opts = append(opts, n.Options()...)
	return NewServer(opts...)
}

func init() {
	config.RegisterOptions(&options)
	pl := &hertzServerPlugin{}
	plugin.ServerPlugins[pl.Name()] = &hertzServerPlugin{}
}
