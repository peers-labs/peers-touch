package relay

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

	Enabled           bool
	MaxStations       int
	MaxRequestsPerSec int
	HeartbeatTimeout  int

	TurnEnabled    bool
	TurnPublicIP   string
	TurnPort       int
	TurnAuthSecret string
}

func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

func WithMaxStations(max int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.MaxStations = max
	})
}

func WithMaxRequestsPerSec(max int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.MaxRequestsPerSec = max
	})
}

func WithHeartbeatTimeout(seconds int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.HeartbeatTimeout = seconds
	})
}

func WithTurnEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.TurnEnabled = enabled
	})
}

func WithTurnPublicIP(ip string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.TurnPublicIP = ip
	})
}

func WithTurnPort(port int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.TurnPort = port
	})
}

func WithTurnAuthSecret(secret string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.TurnAuthSecret = secret
	})
}
