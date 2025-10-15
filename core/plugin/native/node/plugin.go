package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/node"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
)

var options struct {
	Peers struct {
		Node struct {
		} `pconf:"node"`
	} `pconf:"peers"`
}

type nativeServicePlugin struct {
}

func (n *nativeServicePlugin) New(opts *option.Options, o ...option.Option) node.Node {
	return NewService(opts, o...)
}

func (n *nativeServicePlugin) Name() string {
	return "native"
}

func (n *nativeServicePlugin) Options() []option.Option {
	var opts []option.Option

	return opts
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServicePlugins[plugin.NativePluginName] = &nativeServicePlugin{}
}
