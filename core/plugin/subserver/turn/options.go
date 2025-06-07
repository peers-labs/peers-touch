package turn

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

type Options struct {
	*option.Options

	Enabled    bool
	Port       int
	Realm      string
	PublicIP   string
	AuthSecret string
}

func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

func WithPort(port int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Port = port
	})
}

func WithRealm(realm string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Realm = realm
	})
}

func WithPublicIP(ip string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.PublicIP = ip
	})
}

func WithAuthSecret(secret string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.AuthSecret = secret
	})
}
