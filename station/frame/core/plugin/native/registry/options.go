package native

import (
	"context"
	"time"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/multiformats/go-multiaddr"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
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
}

var (
	Wrapper = option.NewWrapper[options]()
)

// WithBootstrapNodes set the private bootstrap nodes for the registry plugin.
