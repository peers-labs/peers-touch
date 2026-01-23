package signaling

import (
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

type Options struct {
	*option.Options

	Enabled            bool
	SessionTTL         int
	MaxPeersPerSession int
}

func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

func WithSessionTTL(ttl int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.SessionTTL = ttl
	})
}

func WithMaxPeersPerSession(max int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.MaxPeersPerSession = max
	})
}
