package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

type options struct {
	*registry.Options

	BootstrapNodes []string
	RelayNodes     []string

	// public nodes are used for public network, such as the bootstrap nodes, relay nodes, etc.
	// Init will help to set the public nodes for the registry plugin.
	publicBootstrapNodes []string
	publicRelayNodes     []string
}

func WithBootstrapNodes(bootstraps []string) option.Option {
	return wrapOptions(func(o *options) {
		o.BootstrapNodes = bootstraps
	})
}

func WithRelayNodes(relayNodes []string) option.Option {
	return wrapOptions(func(o *options) {
		o.RelayNodes = relayNodes
	})
}

func wrapOptions(f func(o *options)) option.Option {
	return registry.OptionWrapper.Wrap(func(o *registry.Options) {
		if o.ExtOptions == nil {
			o.ExtOptions = &options{
				Options: o,
			}
		}
		f(o.ExtOptions.(*options))
	})
}
