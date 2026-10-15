package relay

import (
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{Options: options}
})

type Options struct {
	*option.Options

	Enabled       bool
	MaxStations   int
	PublicBaseURL string

	TurnEnabled    bool
	TurnPublicIP   string
	TurnPort       int
	TurnAuthSecret string

	OperatorKeyFile  string
	OperatorIssuer   string
	OperatorAudience string
	OperatorScope    string

	Admission *nativeRelay.Admission
	Host      host.Host
}

func WithEnabled(value bool) option.Option {
	return wrapper.Wrap(func(options *Options) { options.Enabled = value })
}

func WithMaxStations(value int) option.Option {
	return wrapper.Wrap(func(options *Options) { options.MaxStations = value })
}

func WithPublicBaseURL(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.PublicBaseURL = value })
}

func WithTurnEnabled(value bool) option.Option {
	return wrapper.Wrap(func(options *Options) { options.TurnEnabled = value })
}

func WithTurnPublicIP(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.TurnPublicIP = value })
}

func WithTurnPort(value int) option.Option {
	return wrapper.Wrap(func(options *Options) { options.TurnPort = value })
}

func WithTurnAuthSecret(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.TurnAuthSecret = value })
}

func WithOperatorKeyFile(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.OperatorKeyFile = value })
}

func WithOperatorIssuer(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.OperatorIssuer = value })
}

func WithOperatorAudience(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.OperatorAudience = value })
}

func WithOperatorScope(value string) option.Option {
	return wrapper.Wrap(func(options *Options) { options.OperatorScope = value })
}

func WithAdmission(value *nativeRelay.Admission) option.Option {
	return wrapper.Wrap(func(options *Options) { options.Admission = value })
}

func WithHost(value host.Host) option.Option {
	return wrapper.Wrap(func(options *Options) { options.Host = value })
}
