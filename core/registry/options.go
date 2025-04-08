package registry

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

var (
	opts *Options
)

type registryOptionsKey struct{}

var OptionWrapper = option.NewWrapper[Options](registryOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// region Options

// Option is a function that can be used to configure a Registry
type Option func(*Options)

type Options struct {
	*option.Options

	Extends any
}

type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	TTL time.Duration
}

type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct {
}

type GetOption func(*GetOptions)

type GetOptions struct {
}

type WatchOption func(*WatchOptions)

type WatchOptions struct{}

// endregion
