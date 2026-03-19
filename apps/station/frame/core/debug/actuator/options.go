// Package actuator provides a simple debug server for health and info endpoints.
package actuator

import (
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
)

type debugServerOptionsKey struct{}

var debugOptionWrapper = option.NewWrapper[DebugServerOptions](debugServerOptionsKey{}, func(options *option.Options) *DebugServerOptions {
	return &DebugServerOptions{
		Options: options,
	}
})

// DebugServerOptions holds options for the debug server.
type DebugServerOptions struct {
	*option.Options

	path     string
	registry registry.Registry
}

// WithDebugServerRegistry injects a registry for debug endpoints.
func WithDebugServerRegistry(reg registry.Registry) option.Option {
	return debugOptionWrapper.Wrap(func(opts *DebugServerOptions) {
		opts.registry = reg
	})
}

// WithDebugServerPath sets the path prefix for debug server.
func WithDebugServerPath(path string) option.Option {
	return debugOptionWrapper.Wrap(func(opts *DebugServerOptions) {
		opts.path = path
	})
}
