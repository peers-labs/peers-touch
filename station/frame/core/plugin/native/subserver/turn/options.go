// Package turn exposes option helpers for the TURN subserver.
package turn

import (
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// Options holds configuration for the TURN subserver.
type Options struct {
	*option.Options

	Enabled    bool
	Port       int
	Realm      string
	PublicIP   string
	AuthSecret string
}

// WithEnabled toggles the TURN subserver.
func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

// WithPort sets the TURN listening port.
func WithPort(port int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Port = port
	})
}

// WithRealm sets the TURN authentication realm.
func WithRealm(realm string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Realm = realm
	})
}

// WithPublicIP sets the public IP advertised by the TURN server.
func WithPublicIP(ip string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.PublicIP = ip
	})
}

// WithAuthSecret sets an auth secret for TURN credentials.
func WithAuthSecret(secret string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.AuthSecret = secret
	})
}
