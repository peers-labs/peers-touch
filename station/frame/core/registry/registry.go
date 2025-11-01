package registry

import (
	"context"
	"fmt"

	"github.com/peers-touch/peers-touch/station/frame/core/option"
)

var (
	defaultRegistry Registry
)

// Registry unified registration interface - V2 minimalist design
type Registry interface {
	// Basic lifecycle
	Init(ctx context.Context, opts ...option.Option) error
	Options() Options
	String() string

	// Registration operations - using Option pattern philosophy
	Register(ctx context.Context, registration *Registration, opts ...RegisterOption) error
	Deregister(ctx context.Context, id string, opts ...DeregisterOption) error

	// Query operations - unified Query interface
	Query(ctx context.Context, opts ...QueryOption) ([]*Registration, error)

	// Watch operations - fire-and-forget pattern
	Watch(ctx context.Context, callback WatchCallback, opts ...WatchOption) error
}

// SetDefaultRegistry set default registry
func SetDefaultRegistry(registry Registry) {
	defaultRegistry = registry
}

// GetDefaultRegistry get default registry
func GetDefaultRegistry() Registry {
	return defaultRegistry
}

// Register register component (shortcut method)
func Register(ctx context.Context, registration *Registration, opts ...RegisterOption) error {
	if defaultRegistry == nil {
		return fmt.Errorf("no default registry set")
	}
	return defaultRegistry.Register(ctx, registration, opts...)
}

// Deregister deregister component (shortcut method)
func Deregister(ctx context.Context, id string, opts ...DeregisterOption) error {
	if defaultRegistry == nil {
		return fmt.Errorf("no default registry set")
	}
	return defaultRegistry.Deregister(ctx, id, opts...)
}

// Query query components (shortcut method)
func Query(ctx context.Context, opts ...QueryOption) ([]*Registration, error) {
	if defaultRegistry == nil {
		return nil, fmt.Errorf("no default registry set")
	}
	return defaultRegistry.Query(ctx, opts...)
}

// Watch watch component changes (shortcut method)
func Watch(ctx context.Context, callback WatchCallback, opts ...WatchOption) error {
	if defaultRegistry == nil {
		return fmt.Errorf("no default registry set")
	}
	return defaultRegistry.Watch(ctx, callback, opts...)
}
