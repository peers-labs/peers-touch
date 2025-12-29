// Package bootstrap exposes option helpers for the bootstrap subserver.
package bootstrap

import (
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// Options holds configuration for the bootstrap subserver.
type Options struct {
	*option.Options

	Enabled            bool
	EnableMDNS         bool
	IdentityKey        crypto.PrivKey
	ListenAddrs        []string
	BootstrapNodes     []multiaddr.Multiaddr
	DHTRefreshInterval time.Duration
	Libp2pInsecure     bool
	// Private host configuration
	PrivateKey       crypto.PrivKey
	ListenMultiAddrs []multiaddr.Multiaddr
}

// WithIdentityKey sets the identity key used by the bootstrap server.
func WithIdentityKey(keyFile crypto.PrivKey) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.IdentityKey = keyFile
	})
}

// WithListenAddrs appends listening addresses.
func WithListenAddrs(addrs []string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.ListenAddrs = append(o.ListenAddrs, addrs...)
	})
}

// WithMDNS toggles MDNS discovery.
func WithMDNS(enable bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.EnableMDNS = enable
	})
}

// WithEnabled toggles the bootstrap subserver.
func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

// WithBootstrapNodes appends bootstrap multiaddrs.
func WithBootstrapNodes(bootstrapNodes []multiaddr.Multiaddr) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.BootstrapNodes = append(o.BootstrapNodes, bootstrapNodes...)
	})
}

// WithDHTRefreshInterval sets DHT refresh interval.
func WithDHTRefreshInterval(dhtRefreshInterval time.Duration) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.DHTRefreshInterval = dhtRefreshInterval
	})
}

// WithPrivateKey sets private key for the subserver.
func WithPrivateKey(key crypto.PrivKey) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.PrivateKey = key
	})
}

// WithLibp2pInsecure toggles insecure libp2p transport.
func WithLibp2pInsecure(libp2pInsecure bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Libp2pInsecure = libp2pInsecure
	})
}

// WithListenMultiAddrs sets listening multiaddrs.
func WithListenMultiAddrs(addrs []multiaddr.Multiaddr) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.ListenMultiAddrs = addrs
	})
}
