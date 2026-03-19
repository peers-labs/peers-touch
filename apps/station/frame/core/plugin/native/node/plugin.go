package native

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
)

var options struct {
	Peers struct {
		Node struct {
		} `pconf:"node"`
	} `pconf:"peers"`
}

type nativeServicePlugin struct {
}

// New constructs a node service using provided options.
func (n *nativeServicePlugin) New(opts *option.Options, o ...option.Option) node.Node {
	return NewService(opts, o...)
}

// Name returns the plugin identifier.
func (n *nativeServicePlugin) Name() string {
	return "native"
}

// Options returns service options (none for native service).
func (n *nativeServicePlugin) Options() []option.Option {
	var opts []option.Option

	return opts
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServicePlugins[plugin.NativePluginName] = &nativeServicePlugin{}
}
