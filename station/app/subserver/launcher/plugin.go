package launcher

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var launcherPluginOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Launcher struct {
						Enabled bool   `pconf:"enabled"`
						DBName  string `pconf:"rds-name"`
					} `pconf:"launcher"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type launcherPlugin struct{}

func (p *launcherPlugin) Name() string { return "launcher" }

func (p *launcherPlugin) Enabled() bool {
	return launcherPluginOptions.Peers.Node.Server.Subserver.Launcher.Enabled
}

func (p *launcherPlugin) Options() []option.Option {
	return []option.Option{
		WithDBName(launcherPluginOptions.Peers.Node.Server.Subserver.Launcher.DBName),
	}
}

func (p *launcherPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return New(opts...)
}

func init() {
	config.RegisterOptions(&launcherPluginOptions)
	plugin.SubserverPlugins["launcher"] = &launcherPlugin{}
}
