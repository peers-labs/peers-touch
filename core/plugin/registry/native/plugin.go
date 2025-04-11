package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

var configOptions struct {
	Peers struct {
		Service struct {
			Registry struct {
				BootstrapNodes []string `pconf:"bootstrap-nodes"`
			} `pconf:"registry"`
		} `pconf:"service"`
		RunMode ModeOpt `pconf:"run-mode"`
	} `pconf:"peers"`
}

type nativeRegistryPlugin struct {
}

func (n *nativeRegistryPlugin) Name() string {
	return plugin.NativePluginName
}

func (n *nativeRegistryPlugin) Options() []option.Option {
	var opts []option.Option
	if configOptions.Peers.RunMode != ModeAuto {
		opts = append(opts, WithDHTMode(configOptions.Peers.RunMode))
	}

	if len(configOptions.Peers.Service.Registry.BootstrapNodes) > 0 {
		opts = append(opts, WithBootstrapNodes(configOptions.Peers.Service.Registry.BootstrapNodes))
	}

	return opts
}

func (n *nativeRegistryPlugin) New(opts ...option.Option) registry.Registry {
	opts = append(opts, n.Options()...)
	return NewRegistry(opts...)
}

func init() {
	config.RegisterOptions(&configOptions)
	p := &nativeRegistryPlugin{}
	plugin.RegistryPlugins[p.Name()] = p
}
