package bootstrap

import (
	"context"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin/native/subserver/bootstrap/model"
)

var (
	_ network.Notifiee = &libp2pHostNotifee{}
)

type libp2pHostNotifee struct {
	ctx context.Context

	*SubServer
}

func (l libp2pHostNotifee) Listen(n network.Network, multiaddr multiaddr.Multiaddr) {
	ctx := context.Background()
	logger.Infof(ctx, "Host started listening on: %s", multiaddr.String())
}

func (l libp2pHostNotifee) ListenClose(n network.Network, multiaddr multiaddr.Multiaddr) {
	ctx := context.Background()
	logger.Infof(ctx, "Host stopped listening on: %s", multiaddr.String())
}

// Connected listens to the connected event that the peer connects to,
// which means that it works for the active outgoing connection, not the ones passive incoming.
func (l libp2pHostNotifee) Connected(n network.Network, conn network.Conn) {
	logger.Infof(l.ctx, "Connected to peer: %s, direction: %s. ", conn.RemotePeer().String(), conn.Stat().Direction)
	l.saveConnInfo(n, conn, true)
}

func (l libp2pHostNotifee) Disconnected(n network.Network, conn network.Conn) {
	l.saveConnInfo(n, conn, false)
}

func (l libp2pHostNotifee) saveConnInfo(n network.Network, conn network.Conn, isActive bool) {
	ctx := context.Background()
	peerInfo, connInfo := l.GetPeerAndConnectionInfo(conn, isActive)
	err := l.savePeerInfo(ctx, peerInfo, connInfo)
	if err != nil {
		logger.Errorf(ctx, "Failed to save peer info: %s", err)
		return
	}

	logger.Infof(ctx, "disconnected from peer: %s, IPv4: %s", peerInfo.PeerID, connInfo.IPv4)
}

// getIpv4AndIpv6 extracts IPv4 and IPv6 addresses from a multiaddr
func (l libp2pHostNotifee) getIpv4AndIpv6(addr multiaddr.Multiaddr) (ipv4, ipv6 string) {
	if addr == nil {
		return "", ""
	}

	components := addr.Protocols()
	for _, proto := range components {
		switch proto.Code {
		case multiaddr.P_IP4: // IPv4 protocol code (0x0004)
			ipv4, _ = addr.ValueForProtocol(multiaddr.P_IP4)
		case multiaddr.P_IP6: // IPv6 protocol code (0x0029)
			ipv6, _ = addr.ValueForProtocol(multiaddr.P_IP6)
		}
	}
	return ipv4, ipv6
}

// GetPeerAndConnectionInfo extracts PeerInfo and ConnectionInfo from a libp2p connection
func (l libp2pHostNotifee) GetPeerAndConnectionInfo(conn network.Conn, isActive bool) (model.PeerInfo, model.ConnectionInfo) {
	pid := conn.RemotePeer()
	remoteAddr := conn.RemoteMultiaddr()
	localAddr := conn.LocalMultiaddr()

	// Extract IPv4/IPv6 from remote address
	ipv4, ipv6 := l.getIpv4AndIpv6(remoteAddr)

	// Get connection direction as string
	direction := ""
	switch conn.Stat().Direction {
	case network.DirInbound:
		direction = "inbound"
	case network.DirOutbound:
		direction = "outbound"
	default:
		direction = "unknown"
	}

	// Populate PeerInfo
	peerInfo := model.PeerInfo{
		PeerID:      pid.String(),
		FirstSeenAt: time.Now(), // Use current time as first seen (adjust if tracking existing peers)
	}

	// Populate ConnectionInfo
	connectionInfo := model.ConnectionInfo{
		PeerID:          pid.String(),
		IPv4:            ipv4,
		IPv6:            ipv6,
		Direction:       direction,
		LocalMultiAddr:  localAddr.String(),
		RemoteMultiAddr: remoteAddr.String(),
		IsActive:        isActive,
	}

	if isActive {
		connectionInfo.ConnectedAt = time.Now()
	} else {
		connectionInfo.DisconnectedAt = time.Now()
	}

	return peerInfo, connectionInfo
}
