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

	Enabled          bool
	MaxStations      int
	HeartbeatTimeout int

	// Forward settings
	ForwardTimeout          int
	MaxBodySize             int
	MaxConcurrentPerStation int

	// Stream keepalive
	StreamPingInterval int
	StreamPingTimeout  int
	StreamListenAddr   string
	PublicBaseURL      string

	// Graceful shutdown
	GracefulDrainTimeout int

	// TURN integration
	TurnEnabled    bool
	TurnPublicIP   string
	TurnPort       int
	TurnAuthSecret string

	// TLS for stream listener (Block 8)
	TLSCertFile           string
	TLSKeyFile            string
	AllowInsecureLoopback bool
	SigningKeyFile        string
	OperatorKeyFile       string
	OperatorIssuer        string
	OperatorAudience      string
	OperatorScope         string
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

func WithHeartbeatTimeout(seconds int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.HeartbeatTimeout = seconds
	})
}

func WithForwardTimeout(seconds int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.ForwardTimeout = seconds
	})
}

func WithMaxBodySize(bytes int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.MaxBodySize = bytes
	})
}

func WithMaxConcurrentPerStation(n int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.MaxConcurrentPerStation = n
	})
}

func WithStreamPingInterval(seconds int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.StreamPingInterval = seconds
	})
}

func WithStreamPingTimeout(seconds int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.StreamPingTimeout = seconds
	})
}

func WithStreamListenAddr(addr string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.StreamListenAddr = addr
	})
}

func WithPublicBaseURL(baseURL string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.PublicBaseURL = baseURL
	})
}

func WithGracefulDrainTimeout(seconds int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.GracefulDrainTimeout = seconds
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

func WithTLSCertFile(path string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.TLSCertFile = path
	})
}

func WithTLSKeyFile(path string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.TLSKeyFile = path
	})
}

func WithAllowInsecureLoopback(allow bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.AllowInsecureLoopback = allow
	})
}

func WithSigningKeyFile(path string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.SigningKeyFile = path
	})
}

func WithOperatorKeyFile(path string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.OperatorKeyFile = path
	})
}

func WithOperatorIssuer(issuer string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.OperatorIssuer = issuer
	})
}

func WithOperatorAudience(audience string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.OperatorAudience = audience
	})
}

func WithOperatorScope(scope string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.OperatorScope = scope
	})
}
