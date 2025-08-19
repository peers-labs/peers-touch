package client

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/client"
)

var options struct {
	Peers struct {
		Service struct {
			Client struct {
				Native struct {
					Enabled bool `pconf:"enabled"`
				} `pconf:"native"`
			} `pconf:"client"`
		} `pconf:"service"`
	} `pconf:"peers"`
}

type nativeClientPlugin struct {
}

func (n *nativeClientPlugin) Name() string {
	return plugin.NativePluginName
}

func (n *nativeClientPlugin) Options() []option.Option {
	var opts []option.Option
	// Add any client-specific options here if needed
	return opts
}

func (n *nativeClientPlugin) New(opts ...option.Option) client.Client {
	opts = append(opts, n.Options()...)
	return NewClient(opts...)
}

// NewNodeClient creates a new NodeClient with extended functionality
func (n *nativeClientPlugin) NewNodeClient(opts ...option.Option) NodeClient {
	opts = append(opts, n.Options()...)
	return NewClient(opts...).(*libp2pClient)
}

func init() {
	config.RegisterOptions(&options)
	plugin.ClientPlugins[plugin.NativePluginName] = &nativeClientPlugin{}
}