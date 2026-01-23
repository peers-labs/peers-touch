package signaling

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var signalingOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Signaling struct {
						Enabled            bool `pconf:"enabled"`
						SessionTTL         int  `pconf:"session-ttl"`
						MaxPeersPerSession int  `pconf:"max-peers-per-session"`
					} `pconf:"signaling"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type signalingPlugin struct{}

func (p *signalingPlugin) Name() string {
	return "signaling"
}

func (p *signalingPlugin) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(signalingOptions.Peers.Node.Server.Subserver.Signaling.Enabled))

	if signalingOptions.Peers.Node.Server.Subserver.Signaling.SessionTTL > 0 {
		opts = append(opts, WithSessionTTL(signalingOptions.Peers.Node.Server.Subserver.Signaling.SessionTTL))
	}

	if signalingOptions.Peers.Node.Server.Subserver.Signaling.MaxPeersPerSession > 0 {
		opts = append(opts, WithMaxPeersPerSession(signalingOptions.Peers.Node.Server.Subserver.Signaling.MaxPeersPerSession))
	}

	return opts
}

func (p *signalingPlugin) Enabled() bool {
	return signalingOptions.Peers.Node.Server.Subserver.Signaling.Enabled
}

func (p *signalingPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewSignalingSubServer(opts...)
}

func init() {
	config.RegisterOptions(&signalingOptions)
	plugin.SubserverPlugins["signaling"] = &signalingPlugin{}
}
