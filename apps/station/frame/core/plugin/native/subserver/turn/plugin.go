package turn

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var turnOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					TURN struct {
						Enabled            bool     `pconf:"enabled"`
						Port               int      `pconf:"port"`
						Realm              string   `pconf:"realm"`
						PublicIP           string   `pconf:"public-ip"`
						AuthSecret         string   `pconf:"auth-secret"`
						STUNURLs           []string `pconf:"stun-urls"`
						CredentialTTL      string   `pconf:"credential-ttl"`
						CredentialUsername string   `pconf:"credential-username"`
					} `pconf:"turn"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type turnPlugin struct{}

// Name returns the plugin identifier.
func (p *turnPlugin) Name() string {
	return "turn"
}

// Options converts configuration into subserver options.
func (p *turnPlugin) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(turnOptions.Peers.Node.Server.Subserver.TURN.Enabled))

	if turnOptions.Peers.Node.Server.Subserver.TURN.Port > 0 {
		opts = append(opts, WithPort(turnOptions.Peers.Node.Server.Subserver.TURN.Port))
	}

	if turnOptions.Peers.Node.Server.Subserver.TURN.Realm != "" {
		opts = append(opts, WithRealm(turnOptions.Peers.Node.Server.Subserver.TURN.Realm))
	}

	if turnOptions.Peers.Node.Server.Subserver.TURN.PublicIP != "" {
		opts = append(opts, WithPublicIP(turnOptions.Peers.Node.Server.Subserver.TURN.PublicIP))
	}

	if turnOptions.Peers.Node.Server.Subserver.TURN.AuthSecret != "" {
		opts = append(opts, WithAuthSecret(turnOptions.Peers.Node.Server.Subserver.TURN.AuthSecret))
	}

	if len(turnOptions.Peers.Node.Server.Subserver.TURN.STUNURLs) > 0 {
		opts = append(opts, WithSTUNURLs(turnOptions.Peers.Node.Server.Subserver.TURN.STUNURLs))
	}

	if ttl := turnOptions.Peers.Node.Server.Subserver.TURN.CredentialTTL; ttl != "" {
		if d, err := time.ParseDuration(ttl); err == nil && d > 0 {
			opts = append(opts, WithCredentialTTL(d))
		}
	}

	if turnOptions.Peers.Node.Server.Subserver.TURN.CredentialUsername != "" {
		opts = append(opts, WithCredentialUsername(turnOptions.Peers.Node.Server.Subserver.TURN.CredentialUsername))
	}

	return opts
}

// Enabled reports whether the TURN subserver is enabled.
func (p *turnPlugin) Enabled() bool {
	return turnOptions.Peers.Node.Server.Subserver.TURN.Enabled
}

// New constructs a new TURN subserver with plugin options.
func (p *turnPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)

	return NewTurnSubServer(opts...)
}

func init() {
	config.RegisterOptions(&turnOptions)
	plugin.SubserverPlugins["turn"] = &turnPlugin{}
}
