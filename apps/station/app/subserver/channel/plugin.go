package channel

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var channelOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Channel struct {
						Enabled bool   `pconf:"enabled"`
						Path    string `pconf:"path"`
					} `pconf:"channel"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type channelPlugin struct{}

func (p *channelPlugin) Name() string { return "channel" }

func (p *channelPlugin) Options() []option.Option {
	return []option.Option{
		WithPath(channelOptions.Peers.Node.Server.Subserver.Channel.Path),
		WithDBName("channel"),
	}
}

func (p *channelPlugin) Enabled() bool {
	return channelOptions.Peers.Node.Server.Subserver.Channel.Enabled
}

func (p *channelPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewChannelSubServer(opts...)
}

func init() {
	config.RegisterOptions(&channelOptions)
	plugin.SubserverPlugins["channel"] = &channelPlugin{}
}
