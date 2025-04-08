package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

type options struct {
	registry.Options

	BootstrapNodes []string
}

func WithBootstrapNodes(bootstraps []string) option.Option {
	return registry.OptionWrapper.Wrap(func(o *registry.Options) {
		o.
	})
}
