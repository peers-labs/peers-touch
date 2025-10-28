package bootstrap

import (
	"github.com/peers-touch/peers-touch-go/core/config"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/plugin"
)

var options struct {
	Peers struct {
		Node struct {
		} `pconf:"node"`
	} `pconf:"peers"`
}

type bootstrapPlugion struct {
}

func (n *bootstrapPlugion) New(opts *option.Options, o ...option.Option) Bootstrap {
	return NewBootstrap(opts, o...)
}

func (n *bootstrapPlugion) Name() string {
	return "native"
}

func (n *bootstrapPlugion) Options() []option.Option {
	var opts []option.Option

	return opts
}

func init() {
	config.RegisterOptions(&options)
	plugin.ServicePlugins[plugin.NativePluginName].SetComponent(&bootstrapPlugion{})
}
