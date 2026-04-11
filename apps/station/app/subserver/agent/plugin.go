package agent

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var agentOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Agent struct {
						Enabled bool `pconf:"enabled"`
					} `pconf:"agent"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type agentPlugin struct{}

func (p *agentPlugin) Name() string { return "agent" }

func (p *agentPlugin) Options() []option.Option {
	return []option.Option{
		WithDBName("agent"),
	}
}

func (p *agentPlugin) Enabled() bool {
	return agentOptions.Peers.Node.Server.Subserver.Agent.Enabled
}

func (p *agentPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewAgentSubServer(opts...)
}

func init() {
	config.RegisterOptions(&agentOptions)
	plugin.SubserverPlugins["agent"] = &agentPlugin{}
}
