package bootstrap

import (
	"time"
	
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/multiformats/go-multiaddr"
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
	IdentityKey        crypto.PrivKey
	ListenAddrs        []string
	BootstrapNodes     []multiaddr.Multiaddr
	DHTRefreshInterval time.Duration
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
