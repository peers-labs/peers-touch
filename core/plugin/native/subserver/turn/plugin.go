package turn

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

var turnOptions struct {
	Peers struct {
		Service struct {
			Server struct {
				Subserver struct {
					TURN struct {
						Enabled    bool   `pconf:"enabled"`
						Port       int    `pconf:"port"`
						Realm      string `pconf:"realm"`
						PublicIP   string `pconf:"public-ip"`
						AuthSecret string `pconf:"auth-secret"`
					} `pconf:"turn"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"service"`
	} `pconf:"peers"`
}

type turnPlugin struct{}

func (p *turnPlugin) Name() string {
	return "turn"
}

func (p *turnPlugin) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(turnOptions.Peers.Service.Server.Subserver.TURN.Enabled))

	if turnOptions.Peers.Service.Server.Subserver.TURN.Port > 0 {
		opts = append(opts, WithPort(turnOptions.Peers.Service.Server.Subserver.TURN.Port))
	}

	if turnOptions.Peers.Service.Server.Subserver.TURN.Realm != "" {
		opts = append(opts, WithRealm(turnOptions.Peers.Service.Server.Subserver.TURN.Realm))
	}

	if turnOptions.Peers.Service.Server.Subserver.TURN.PublicIP != "" {
		opts = append(opts, WithPublicIP(turnOptions.Peers.Service.Server.Subserver.TURN.PublicIP))
	}

	if turnOptions.Peers.Service.Server.Subserver.TURN.AuthSecret != "" {
		opts = append(opts, WithAuthSecret(turnOptions.Peers.Service.Server.Subserver.TURN.AuthSecret))
	}

	return opts
}

func (p *turnPlugin) Enabled() bool {
	return turnOptions.Peers.Service.Server.Subserver.TURN.Enabled
}

func (p *turnPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)

	return NewTurnSubServer(opts...)
}

func init() {
	config.RegisterOptions(&turnOptions)
	plugin.SubserverPlugins["turn"] = &turnPlugin{}
}
