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

	Interval       time.Duration
	ConnectTimeout time.Duration
	PrivateKey     string
}

func WithInterval(dur time.Duration) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.Interval = dur
	})
}

func WithConnectTimeout(dur time.Duration) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.ConnectTimeout = dur
	})
}

func WithPrivateKey(privateKey string) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.PrivateKey = privateKey
	})
}

type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	Namespace string
	Interval  time.Duration
	TTL       time.Duration
}

type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct {
}

type GetOption func(*GetOptions)

type GetOptions struct {
	NameIsPeerID bool
}

func WithNameIsPeerID() GetOption {
	return func(o *GetOptions) {
		o.NameIsPeerID = true
	}
}

type WatchOption func(*WatchOptions)

type WatchOptions struct{}

// endregion

func GetPluginRegions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(registryOptionsKey{}).(*Options)
}
