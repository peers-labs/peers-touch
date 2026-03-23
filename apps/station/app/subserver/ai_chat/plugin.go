package aichat

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// Configuration structure loaded via pconf hierarchy
var aiChatOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					AIChat struct {
						Enabled bool   `pconf:"enabled"`
						DBName  string `pconf:"db-name"`
					} `pconf:"ai-chat"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type aiChatPlugin struct{}

func (p *aiChatPlugin) Name() string { return "ai-chat" }

func (p *aiChatPlugin) Options() []option.Option {
	var opts []option.Option
	if name := aiChatOptions.Peers.Node.Server.Subserver.AIChat.DBName; name != "" {
		opts = append(opts, WithDBName(name))
	}
	return opts
}

func (p *aiChatPlugin) Enabled() bool {
	return aiChatOptions.Peers.Node.Server.Subserver.AIChat.Enabled
}

func (p *aiChatPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewAIChatSubServer(opts...)
}

func init() {
	config.RegisterOptions(&aiChatOptions)
	plugin.SubserverPlugins["ai-chat"] = &aiChatPlugin{}
}
