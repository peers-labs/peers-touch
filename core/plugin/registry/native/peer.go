package native

import (
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
)

type Peer struct {
	host host.Host
	dht  *dht.IpfsDHT
}
