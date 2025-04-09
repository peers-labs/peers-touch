package registry

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

type registryOptionsKey struct{}

var OptionWrapper = option.NewWrapper[Options](registryOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// region Options

// Options is the options for the registry plugin.
type Options struct {
	*option.Options
}

type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	Namespace string
	TTL       time.Duration
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

func GetPluginRegions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(registryOptionsKey{}).(*Options)
}
