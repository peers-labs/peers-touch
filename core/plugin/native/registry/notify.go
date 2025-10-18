package native

import (
	"context"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch-go/core/logger"
)

var (
	_ network.Notifiee = &libp2pHostNotifee{}
)

type libp2pHostNotifee struct {
	*nativeRegistry
}

func (l libp2pHostNotifee) Listen(n network.Network, multiaddr multiaddr.Multiaddr) {
	ctx := context.Background()
	logger.Infof(ctx, "Host started listening on: %s", multiaddr.String())
}

func (l libp2pHostNotifee) ListenClose(n network.Network, multiaddr multiaddr.Multiaddr) {
	ctx := context.Background()
	logger.Infof(ctx, "Host stopped listening on: %s", multiaddr.String())
}

func (l libp2pHostNotifee) Connected(n network.Network, conn network.Conn) {
	ctx := context.Background()
	pid := conn.RemotePeer()
	remoteAddr := conn.RemoteMultiaddr()

	// Get all protocol components
	components := remoteAddr.Protocols()
	var ip string
	for _, proto := range components {
		if proto.Code == multiaddr.P_IP4 || proto.Code == multiaddr.P_IP6 {
			// Extract the IP value for this protocol
			ip, _ = remoteAddr.ValueForProtocol(proto.Code)
			break
		}
	}

	logger.Infof(ctx, "connected to peer: %s, IP: %s", pid.String(), ip)
}

func (l libp2pHostNotifee) Disconnected(n network.Network, conn network.Conn) {
	ctx := context.Background()
	pid := conn.RemotePeer()
	remoteAddr := conn.RemoteMultiaddr()

	// Get all protocol components
	components := remoteAddr.Protocols()
	var ip string
	for _, proto := range components {
		if proto.Code == multiaddr.P_IP4 || proto.Code == multiaddr.P_IP6 {
			// Extract the IP value for this protocol
			ip, _ = remoteAddr.ValueForProtocol(proto.Code)
			break
		}
	}

	logger.Infof(ctx, "disconnected from peer: %s, IP: %s", pid.String(), ip)
}
