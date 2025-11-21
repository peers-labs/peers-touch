package option

import (
	"context"
)

type Options struct {
	// Ctx is a context that can be used to pass values between options.
	Ctx context.Context
	// ExtOptions is a field that can be used to extend the options with
	// additional fields.
	ExtOptions any
}

// Wrapper is a generic wrapper for options.
type Wrapper[T any] struct {
	Options
}

// NewWrapper creates a new generic wrapper for options.
func NewWrapper[T any]() *Wrapper[T] {
	return &Wrapper[T]{}
}

// Wrap wraps a function that modifies the options.
func (w *Wrapper[T]) Wrap(f func(o *T)) Option {
	return func(o *Options) {
		if o.ExtOptions == nil {
			o.ExtOptions = new(T)
		}
		f(o.ExtOptions.(*T))
	}
}

// Ext is a helper function to extract the extended options.
func Ext[T any](o *Options) *T {
	if o.ExtOptions == nil {
		return nil
	}
	return o.ExtOptions.(*T)
}

// Option is a function that modifies the options.
type Option func(o *Options)

// Apply applies the options to the options struct.
func (o *Options) Apply(opts ...Option) {
	for _, opt := range opts {
		opt(o)
	}
}

// New returns a new options struct with the given options applied.
func New(opts ...Option) *Options {
	options := &Options{}
	options.Apply(opts...)
	return options
}
