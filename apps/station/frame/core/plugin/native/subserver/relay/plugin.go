package relay

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var relayOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Relay struct {
						Enabled           bool `pconf:"enabled"`
						MaxStations       int  `pconf:"max-stations"`
						MaxRequestsPerSec int  `pconf:"max-requests-per-sec"`
						HeartbeatTimeout  int  `pconf:"heartbeat-timeout"`
					} `pconf:"relay"`
					Turn struct {
						Enabled    bool   `pconf:"enabled"`
						Port       int    `pconf:"port"`
						PublicIP   string `pconf:"public-ip"`
						AuthSecret string `pconf:"auth-secret"`
					} `pconf:"turn"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type relayPlugin struct{}

func (p *relayPlugin) Name() string {
	return "relay"
}

func (p *relayPlugin) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(relayOptions.Peers.Node.Server.Subserver.Relay.Enabled))

	if relayOptions.Peers.Node.Server.Subserver.Relay.MaxStations > 0 {
		opts = append(opts, WithMaxStations(relayOptions.Peers.Node.Server.Subserver.Relay.MaxStations))
	}

	if relayOptions.Peers.Node.Server.Subserver.Relay.MaxRequestsPerSec > 0 {
		opts = append(opts, WithMaxRequestsPerSec(relayOptions.Peers.Node.Server.Subserver.Relay.MaxRequestsPerSec))
	}

	if relayOptions.Peers.Node.Server.Subserver.Relay.HeartbeatTimeout > 0 {
		opts = append(opts, WithHeartbeatTimeout(relayOptions.Peers.Node.Server.Subserver.Relay.HeartbeatTimeout))
	}

	turn := relayOptions.Peers.Node.Server.Subserver.Turn
	opts = append(opts, WithTurnEnabled(turn.Enabled))
	if turn.PublicIP != "" {
		opts = append(opts, WithTurnPublicIP(turn.PublicIP))
	}
	if turn.Port > 0 {
		opts = append(opts, WithTurnPort(turn.Port))
	}
	if turn.AuthSecret != "" {
		opts = append(opts, WithTurnAuthSecret(turn.AuthSecret))
	}

	return opts
}

func (p *relayPlugin) Enabled() bool {
	return relayOptions.Peers.Node.Server.Subserver.Relay.Enabled
}

func (p *relayPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewRelaySubServer(opts...)
}

func init() {
	config.RegisterOptions(&relayOptions)
	plugin.SubserverPlugins["relay"] = &relayPlugin{}
}
