package native

import (
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

func wrapOptions(f func(o *options)) option.Option {
	return transport.OptionWrapper.Wrap(func(o *transport.Options) {
		if o.ExtOptions == nil {
			o.ExtOptions = &options{
				Options: o,
			}
		}
		f(o.ExtOptions.(*options))
	})
}

// options is the extended options for the native transport plugin.
type options struct {
	*transport.Options

	// EnableRelay tells the transport to enable relay
	EnableRelay bool
	// StaticRelays contains the addresses of static relay nodes to use.
	StaticRelays []multiaddr.Multiaddr
	// SecurityTransports configures the security protocols to use (e.g., "noise", "tls").
	SecurityTransports []string
	// Multiplexers configures the stream multiplexers to use (e.g., "yamux", "mplex").
	Multiplexers          []string
	libp2pIdentityKeyFile string
}

// EnableRelay enables the use of circuit relay.
func EnableRelay() option.Option {
	return wrapOptions(func(o *options) {
		o.EnableRelay = true
	})
}

// WithStaticRelays sets the static relay nodes for the transport.
func WithStaticRelays(relays []string) option.Option {
	return wrapOptions(func(o *options) {
		for _, r := range relays {
			addr, err := multiaddr.NewMultiaddr(r)
			if err != nil {
				// Following the pattern in registry/options.go, we panic.
				panic(err)
			}
			o.StaticRelays = append(o.StaticRelays, addr)
		}
	})
}

// WithSecurityTransports sets the security transports to use.
// Valid options are "noise" and "tls".
func WithSecurityTransports(transports []string) option.Option {
	return wrapOptions(func(o *options) {
		o.SecurityTransports = append(o.SecurityTransports, transports...)
	})
}

// WithMultiplexers sets the stream multiplexers to use.
// Valid options are "yamux" and "mplex".
func WithMultiplexers(multiplexers []string) option.Option {
	return wrapOptions(func(o *options) {
		o.Multiplexers = append(o.Multiplexers, multiplexers...)
	})
}

func WithLibp2pIdentityKeyFile(path string) option.Option {
	return wrapOptions(func(o *options) {
		o.libp2pIdentityKeyFile = path
	})
}
