package native

import (
	"context"
	"time"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/multiformats/go-multiaddr"
	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/registry"
)

type modeOpt = dht.ModeOpt

const (
	// ModeAuto utilizes EvtLocalReachabilityChanged events sent over the event bus to dynamically switch the DHT
	// between Client and Server modes based on network conditions
	ModeAuto = dht.ModeAuto
	// ModeClient operates the DHT as a client only, it cannot respond to incoming queries
	ModeClient = dht.ModeClient
	// ModeServer operates the DHT as a server, it can both send and respond to queries
	ModeServer = dht.ModeServer
	// ModeAutoServer operates in the same way as ModeAuto, but acts as a server when reachability is unknown
	ModeAutoServer = dht.ModeAutoServer
)

type options struct {
	*registry.Options

	runMode modeOpt

	privKeyPath              string
	libp2pIdentityKeyFile    string
	bootstrapNodeRetryTimes  int
	bootstrapRefreshInterval time.Duration
	// bootstrap nodes are used for bootstrap the network,
	// not same as the public nodes, the nodes are used for custom network, such as the private network.
	bootstrapNodes []multiaddr.Multiaddr
	// relay nodes are used for relay the messages,
	// not same as the public nodes, the nodes are used for custom network, such as the private network.
	relayNodes []multiaddr.Multiaddr

	// public nodes are used for public network, such as the bootstrap nodes, relay nodes, etc.
	// Init will help to set the public nodes for the registry plugin.
	publicBootstrapNodes []multiaddr.Multiaddr
	publicRelayNodes     []multiaddr.Multiaddr

	// mdnsEnable is used to enable the mdns discovery for the registry plugin.
	// default is false.
	mdnsEnable bool

	// bootstrapEnable is used to enable the node to run as a bootstrap server in libp2p network.
	bootstrapEnable      bool
	bootstrapListenAddrs []string
}

// WithBootstrapNodes set the private bootstrap nodes for the registry plugin.
func WithBootstrapNodes(bootstraps []string) option.Option {
	return wrapOptions(func(o *options) {
		for _, bootstrap := range bootstraps {
			// some short strings are used for placeholder or just is an empty dash(-).
			if len(bootstrap) < 10 {
				log.Infof(context.Background(), "bootstrap node[%s] is too short, ignoring bootstrap node", bootstrap)
				continue
			}

			addr, err := multiaddr.NewMultiaddr(bootstrap)
			if err != nil {
				panic(err)
			}
			o.bootstrapNodes = append(o.bootstrapNodes, addr)
		}
	})
}

// WithRelayNodes set the private relay nodes for the registry plugin.
func WithRelayNodes(relayNodes []string) option.Option {
	return wrapOptions(func(o *options) {
		for _, bootstrap := range relayNodes {
			addr, err := multiaddr.NewMultiaddr(bootstrap)
			if err != nil {
				panic(err)
			}
			o.relayNodes = append(o.relayNodes, addr)
		}
	})
}

func WithMDNSEnable(enableMDNS bool) option.Option {
	return wrapOptions(func(o *options) {
		o.mdnsEnable = enableMDNS
	})
}

func WithBootstrapEnable(enableBootstrap bool) option.Option {
	return wrapOptions(func(o *options) {
		o.bootstrapEnable = enableBootstrap
	})
}

// WithBootstrapListenAddrs set the bootstrap listen address for the registry plugin.
// default is "/ip4/0.0.0.0/tcp/4001", if bootstrapEnable is true.
func WithBootstrapListenAddrs(bootstrapListenAddrs ...string) option.Option {
	return wrapOptions(func(o *options) {
		o.bootstrapListenAddrs = append(o.bootstrapListenAddrs, bootstrapListenAddrs...)
	})
}

func WithRunningMode(mod modeOpt) option.Option {
	return wrapOptions(func(o *options) {
		o.runMode = mod
	})
}

func WithBootstrapNodeRetryTimes(times int) option.Option {
	return wrapOptions(func(o *options) {
		o.bootstrapNodeRetryTimes = times
	})
}

func WithBootstrapRefreshInterval(interval time.Duration) option.Option {
	return wrapOptions(func(o *options) {
		o.bootstrapRefreshInterval = interval
	})
}

func WithLibp2pIdentityKeyFile(keyFile string) option.Option {
	return wrapOptions(func(o *options) {
		o.libp2pIdentityKeyFile = keyFile
	})
}

func wrapOptions(f func(o *options)) option.Option {
	return registry.OptionWrapper.Wrap(func(o *registry.Options) {
		if o.ExtOptions == nil {
			o.ExtOptions = &options{
				Options: o,
			}
		}
		f(o.ExtOptions.(*options))
	})
}
