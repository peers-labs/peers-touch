package aibox

import (
	"github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

// Configuration structure loaded via pconf hierarchy
var aiboxOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					AIBox struct {
						Enabled bool   `pconf:"enabled"`
						DBName  string `pconf:"db-name"`
					} `pconf:"ai-box"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type aiBoxPlugin struct{}

func (p *aiBoxPlugin) Name() string { return "ai-box" }

func (p *aiBoxPlugin) Options() []option.Option {
	var opts []option.Option
	if name := aiboxOptions.Peers.Node.Server.Subserver.AIBox.DBName; name != "" {
		opts = append(opts, WithDBName(name))
	}
	return opts
}

func (p *aiBoxPlugin) Enabled() bool {
	return aiboxOptions.Peers.Node.Server.Subserver.AIBox.Enabled
}

func (p *aiBoxPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewAIBoxSubServer(opts...)
}

func init() {
	config.RegisterOptions(&aiboxOptions)
	plugin.SubserverPlugins["ai-box"] = &aiBoxPlugin{}
}
