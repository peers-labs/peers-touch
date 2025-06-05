package turn

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

var turnOptions struct {
	Peers struct {
		Network struct {
			TURN struct {
				Enabled    bool   `pconf:"enabled"`
				Port       int    `pconf:"port"`
				Realm      string `pconf:"realm"`
				PublicIP   string `pconf:"public-ip"`
				AuthSecret string `pconf:"auth-secret"`
			} `pconf:"turn"`
		} `pconf:"network"`
	} `pconf:"peers"`
}

type turnPlugin struct{}

func (p *turnPlugin) Name() string {
	return "turn"
}

func (p *turnPlugin) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(turnOptions.Peers.Network.TURN.Enabled))

	if turnOptions.Peers.Network.TURN.Port > 0 {
		opts = append(opts, WithPort(turnOptions.Peers.Network.TURN.Port))
	}

	if turnOptions.Peers.Network.TURN.Realm != "" {
		opts = append(opts, WithRealm(turnOptions.Peers.Network.TURN.Realm))
	}

	if turnOptions.Peers.Network.TURN.PublicIP != "" {
		opts = append(opts, WithPublicIP(turnOptions.Peers.Network.TURN.PublicIP))
	}

	if turnOptions.Peers.Network.TURN.AuthSecret != "" {
		opts = append(opts, WithAuthSecret(turnOptions.Peers.Network.TURN.AuthSecret))
	}

	return opts
}

func (p *turnPlugin) New(opts ...option.Option) server.SubServer {
	opts = append(opts, p.Options()...)

	return NewTurnSubServer(opts...)
}

func init() {
	config.RegisterOptions(&turnOptions)
}
