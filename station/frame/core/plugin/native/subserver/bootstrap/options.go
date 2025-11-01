package bootstrap

import (
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
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
	EnableMDNS         bool
	IdentityKey        crypto.PrivKey
	ListenAddrs        []string
	BootstrapNodes     []multiaddr.Multiaddr
	DHTRefreshInterval time.Duration

	// Private host configuration
	PrivateKey       crypto.PrivKey
	ListenMultiAddrs []multiaddr.Multiaddr
}

func WithIdentityKey(keyFile crypto.PrivKey) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.IdentityKey = keyFile
	})
}

func WithListenAddrs(addrs []string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.ListenAddrs = append(o.ListenAddrs, addrs...)
	})
}

func WithMDNS(enable bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.EnableMDNS = enable
	})
}

func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

func WithBootstrapNodes(bootstrapNodes []multiaddr.Multiaddr) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.BootstrapNodes = append(o.BootstrapNodes, bootstrapNodes...)
	})
}

func WithDHTRefreshInterval(dhtRefreshInterval time.Duration) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.DHTRefreshInterval = dhtRefreshInterval
	})
}

func WithPrivateKey(key crypto.PrivKey) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.PrivateKey = key
	})
}

func WithListenMultiAddrs(addrs []multiaddr.Multiaddr) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.ListenMultiAddrs = addrs
	})
}
