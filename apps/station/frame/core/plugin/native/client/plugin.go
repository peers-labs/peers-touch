package client

import (
	"github.com/peers-labs/peers-touch/station/frame/core/client"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
)

var options struct {
	Peers struct {
		Service struct {
			Client struct {
				Native struct {
					Enabled bool `pconf:"enabled"`
				} `pconf:"native"`
			} `pconf:"client"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type nativeClientPlugin struct {
}

// Name returns the plugin identifier.
func (n *nativeClientPlugin) Name() string {
	return plugin.NativePluginName
}

// Options returns client options (none for native client).
func (n *nativeClientPlugin) Options() []option.Option {
	var opts []option.Option
	// Add any client-specific options here if needed
	return opts
}

// New constructs a client with plugin options.
func (n *nativeClientPlugin) New(opts ...option.Option) client.Client {
	opts = append(opts, n.Options()...)
	return NewClient(opts...)
}

// NewNodeClient creates a new NodeClient with extended functionality.
func (n *nativeClientPlugin) NewNodeClient(opts ...option.Option) NodeClient {
	opts = append(opts, n.Options()...)
	return NewClient(opts...).(*libp2pClient)
}

func init() {
	config.RegisterOptions(&options)
	plugin.ClientPlugins[plugin.NativePluginName] = &nativeClientPlugin{}
}
