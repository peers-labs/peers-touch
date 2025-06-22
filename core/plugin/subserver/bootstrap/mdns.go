package bootstrap

import (
	"context"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

type mdnsNotifee struct {
	host host.Host

	foundLock  sync.Mutex
	peersFound map[peer.ID]peer.AddrInfo

	refreshLock    sync.Mutex
	peersRefreshed map[peer.ID]peer.AddrInfo

	// Add these new fields for periodic refresh
	ticker    *time.Ticker
	closeChan chan struct{}
}

// Add this initialization in the constructor or creation point
func newMDNSNotifee(h host.Host, refreshInterval time.Duration) *mdnsNotifee {
	n := &mdnsNotifee{
		host:           h,
		peersFound:     make(map[peer.ID]peer.AddrInfo),
		peersRefreshed: make(map[peer.ID]peer.AddrInfo),
		ticker:         time.NewTicker(refreshInterval),
		closeChan:      make(chan struct{}),
	}

	// Start periodic refresh goroutine
	go n.periodicRefresh()
	return n
}

// Add this new method for periodic refresh
func (s *mdnsNotifee) periodicRefresh() {
	for {
		select {
		case <-s.ticker.C:
			s.refresh()
		case <-s.closeChan:
			s.ticker.Stop()
			return
		}
	}
}

// Add this cleanup method to stop the ticker
func (s *mdnsNotifee) Close() {
	close(s.closeChan)
}

func (s *mdnsNotifee) HandlePeerFound(pi peer.AddrInfo) {
	logger.Infof(context.Background(), "Discovered new peer %s\n", pi.ID.String())
	s.foundLock.Lock()
	defer s.foundLock.Unlock()

	s.peersFound[pi.ID] = pi
	s.refresh()
}

// refresh checks the liveness of nodes
func (s *mdnsNotifee) refresh() {
	s.refreshLock.Lock()
	defer s.refreshLock.Unlock()

	// Check liveness for all found peers
	for id, peerInfo := range s.peersFound {
		// Check if we have an active connection
		if s.host.Network().Connectedness(peerInfo.ID) == network.Connected {
			// Add to refreshed peers if alive
			s.peersRefreshed[peerInfo.ID] = peerInfo
			logger.Infof(context.Background(), "Peer %s is alive", peerInfo.ID.String())
		} else {
			// Attempt to reconnect if not connected
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := s.host.Connect(ctx, peerInfo); err != nil {
				logger.Warnf(context.Background(), "Failed to connect to peer %s: %v", peerInfo.ID.String(), err)
				cancel()
			} else {
				s.peersRefreshed[peerInfo.ID] = peerInfo
				logger.Infof(context.Background(), "Successfully connected to peer %s", peerInfo.ID.String())
			}

			cancel()
		}

		// Remove from found peers after processing
		delete(s.peersFound, id)
	}
}

func (s *mdnsNotifee) listAlivePeerAddrs() []multiaddr.Multiaddr {
	s.refreshLock.Lock()
	defer s.refreshLock.Unlock()

	var addrs []multiaddr.Multiaddr
	for _, peerInfo := range s.peersRefreshed {
		addrs = append(addrs, peerInfo.Addrs...)
	}

	return addrs
}
