package actuator

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

type debugServerOptionsKey struct{}

var debugOptionWrapper = option.NewWrapper[DebugServerOptions](debugServerOptionsKey{}, func(options *option.Options) *DebugServerOptions {
	return &DebugServerOptions{
		Options: options,
	}
})

type DebugServerOptions struct {
	*option.Options

	path     string
	registry registry.Registry
}

func WithDebugServerRegistry(reg registry.Registry) option.Option {
	return debugOptionWrapper.Wrap(func(opts *DebugServerOptions) {
		opts.registry = reg
	})
}

func WithDebugServerPath(path string) option.Option {
	return debugOptionWrapper.Wrap(func(opts *DebugServerOptions) {
		opts.path = path
	})
}
