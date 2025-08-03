package native

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
)

var ()

type mdnsNotifee struct {
	host host.Host
}

func (s *mdnsNotifee) HandlePeerFound(pi peer.AddrInfo) {
	logger.Infof(context.Background(), "Discovered new peer %s\n", pi.ID.String())
}
