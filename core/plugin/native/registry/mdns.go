package native

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

type discoveredBootstrapPeer struct {
	AddrInfo    peer.AddrInfo
	DiscoveredAt time.Time
	LastSeen     time.Time
	Connected    bool
	IsBootstrap  bool
}

type mdnsNotifee struct {
	host     host.Host
	registry *nativeRegistry

	// Track discovered bootstrap servers
	discoveredLock sync.RWMutex
	discovered     map[peer.ID]*discoveredBootstrapPeer

	// Periodic refresh
	ticker    *time.Ticker
	closeChan chan struct{}
}

func newMDNSNotifee(h host.Host, registry *nativeRegistry) *mdnsNotifee {
	ctx := context.Background()
	logger.Infof(ctx, "[mDNS] Initializing aggressive mDNS bootstrap discovery service")
	
	n := &mdnsNotifee{
		host:       h,
		registry:   registry,
		discovered: make(map[peer.ID]*discoveredBootstrapPeer),
		ticker:     time.NewTicker(30 * time.Second), // Refresh every 30 seconds
		closeChan:  make(chan struct{}),
	}

	// Start periodic refresh and connection management
	go n.periodicRefresh()
	logger.Infof(ctx, "[mDNS] Bootstrap discovery service started, will check for local bootstrap servers every 30 seconds")
	return n
}

func (s *mdnsNotifee) HandlePeerFound(pi peer.AddrInfo) {
	ctx := context.Background()
	logger.Infof(ctx, "[mDNS] Discovered peer %s with %d addresses", pi.ID.String(), len(pi.Addrs))

	// Skip self
	if pi.ID == s.host.ID() {
		return
	}

	// Check if this looks like a bootstrap server by examining service name or addresses
	isBootstrap := s.isLikelyBootstrapServer(pi)
	if isBootstrap {
		logger.Infof(ctx, "[mDNS] Detected potential bootstrap server: %s", pi.ID.String())
	}

	s.discoveredLock.Lock()
	if existing, exists := s.discovered[pi.ID]; exists {
		// Update existing entry
		existing.LastSeen = time.Now()
		existing.AddrInfo = pi // Update addresses
		existing.IsBootstrap = isBootstrap
	} else {
		// Add new entry
		s.discovered[pi.ID] = &discoveredBootstrapPeer{
			AddrInfo:     pi,
			DiscoveredAt: time.Now(),
			LastSeen:     time.Now(),
			Connected:    false,
			IsBootstrap:  isBootstrap,
		}
		logger.Infof(ctx, "[mDNS] Added new peer to discovery list: %s (bootstrap: %v)", pi.ID.String(), isBootstrap)
	}
	s.discoveredLock.Unlock()

	// Update registry statistics
	s.updateRegistryStats()

	// Immediately try to connect if it looks like a bootstrap server
	if isBootstrap {
		go s.connectToBootstrapPeer(ctx, pi)
	}
}

// isLikelyBootstrapServer determines if a discovered peer is likely a bootstrap server
func (s *mdnsNotifee) isLikelyBootstrapServer(pi peer.AddrInfo) bool {
	// Check if any address uses typical bootstrap ports
	for _, addr := range pi.Addrs {
		addrStr := addr.String()
		// Common bootstrap ports: 4001, 5001, 8080, 9090
		if strings.Contains(addrStr, "/tcp/4001") ||
			strings.Contains(addrStr, "/tcp/5001") ||
			strings.Contains(addrStr, "/tcp/8080") ||
			strings.Contains(addrStr, "/tcp/9090") {
			return true
		}
	}

	// Could also check service names or other heuristics
	return false
}

// connectToBootstrapPeer attempts to connect to a discovered bootstrap peer
func (s *mdnsNotifee) connectToBootstrapPeer(ctx context.Context, pi peer.AddrInfo) {
	logger.Infof(ctx, "[mDNS] Attempting to connect to potential bootstrap server %s", pi.ID.String())

	// Try to connect with timeout
	connCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := s.host.Connect(connCtx, pi); err != nil {
		logger.Warnf(ctx, "[mDNS] Failed to connect to bootstrap peer %s: %v", pi.ID.String(), err)
		s.updateConnectionStatus(pi.ID, false)
	} else {
		logger.Infof(ctx, "[mDNS] Successfully connected to bootstrap peer %s", pi.ID.String())
		s.updateConnectionStatus(pi.ID, true)

		// Add to registry's bootstrap nodes for future use
		s.addToBootstrapNodes(pi)
	}
}

// updateConnectionStatus updates the connection status of a discovered peer
func (s *mdnsNotifee) updateConnectionStatus(peerID peer.ID, connected bool) {
	s.discoveredLock.Lock()
	defer s.discoveredLock.Unlock()

	if peer, exists := s.discovered[peerID]; exists {
		peer.Connected = connected
		peer.LastSeen = time.Now()
	}
}

// addToBootstrapNodes adds a successfully connected peer to the registry's bootstrap nodes
func (s *mdnsNotifee) addToBootstrapNodes(pi peer.AddrInfo) {
	if s.registry == nil {
		return
	}

	// Convert peer info to multiaddr format
	for _, addr := range pi.Addrs {
		// Create full multiaddr with peer ID
		fullAddr := addr.Encapsulate(multiaddr.StringCast("/p2p/" + pi.ID.String()))
		
		// Add to registry's bootstrap nodes if not already present
		alreadyExists := false
		for _, existing := range s.registry.extOpts.bootstrapNodes {
			if existing.Equal(fullAddr) {
				alreadyExists = true
				break
			}
		}

		if !alreadyExists {
			s.registry.extOpts.bootstrapNodes = append(s.registry.extOpts.bootstrapNodes, fullAddr)
			logger.Infof(context.Background(), "[mDNS] Added discovered bootstrap server to bootstrap nodes: %s", fullAddr.String())
		}
	}
}

// periodicRefresh periodically checks discovered peers and maintains connections
func (s *mdnsNotifee) periodicRefresh() {
	ctx := context.Background()
	for {
		select {
		case <-s.ticker.C:
			logger.Infof(ctx, "[mDNS] Running periodic refresh and connection check")
			s.refreshConnections()
		case <-s.closeChan:
			logger.Infof(ctx, "[mDNS] Periodic refresh stopped")
			return
		}
	}
}

// refreshConnections checks and maintains connections to discovered bootstrap peers
func (s *mdnsNotifee) refreshConnections() {
	ctx := context.Background()
	logger.Infof(ctx, "[mDNS] Starting connection refresh...")
	now := time.Now()

	s.discoveredLock.Lock()
	// Note: We manually unlock later after calculating stats

	logger.Infof(ctx, "[mDNS] Discovered peers count: %d", len(s.discovered))

	for peerID, peer := range s.discovered {
		// Remove peers not seen for more than 5 minutes
		if now.Sub(peer.LastSeen) > 5*time.Minute {
			logger.Infof(ctx, "[mDNS] Removing stale peer: %s (last seen: %v ago)", peerID.String(), now.Sub(peer.LastSeen))
			delete(s.discovered, peerID)
			continue
		}

		// Skip non-bootstrap peers
		if !peer.IsBootstrap {
			continue
		}

		// Check connection status
		connectedness := s.host.Network().Connectedness(peerID)
		if connectedness == network.Connected {
			if !peer.Connected {
				logger.Infof(ctx, "[mDNS] Bootstrap peer %s is now connected", peerID.String())
				peer.Connected = true
			}
		} else {
			if peer.Connected {
				logger.Infof(ctx, "[mDNS] Bootstrap peer %s disconnected, attempting reconnect", peerID.String())
				peer.Connected = false
			}
			// Try to reconnect
			go s.connectToBootstrapPeer(ctx, peer.AddrInfo)
		}
	}
	
	logger.Infof(ctx, "[mDNS] Finished processing discovered peers")
	
	// Update registry statistics and log summary (calculate stats while holding the lock)
	logger.Infof(ctx, "[mDNS] About to update registry stats...")
	totalDiscovered := len(s.discovered)
	bootstrapDiscovered := 0
	connectedBootstrap := 0
	activePeers := make([]string, 0, totalDiscovered)
	
	for peerID, peer := range s.discovered {
		activePeers = append(activePeers, peerID.String())
		if peer.IsBootstrap {
			bootstrapDiscovered++
			if peer.Connected {
				connectedBootstrap++
			}
		}
	}
	
	// Release the lock before calling registry methods
	s.discoveredLock.Unlock()
	
	// Update registry stats without holding the lock
	s.registry.updateMDNSStats(totalDiscovered, bootstrapDiscovered, connectedBootstrap, activePeers)
	logger.Infof(ctx, "[mDNS] Registry stats updated successfully")
	logger.Infof(ctx, "[mDNS] About to log discovery stats...")
	s.logDiscoveryStats(ctx)
}

func (s *mdnsNotifee) logDiscoveryStats(ctx context.Context) {
	stats := s.registry.getMDNSStats()
	if stats.TotalDiscovered == 0 {
		logger.Infof(ctx, "[mDNS] Discovery Stats - No local peers discovered yet. mDNS service is active and scanning.")
	} else {
		logger.Infof(ctx, "[mDNS] Discovery Stats - Total: %d, Bootstrap: %d, Connected Bootstrap: %d, Active Peers: %v", 
			stats.TotalDiscovered, stats.BootstrapDiscovered, stats.ConnectedBootstrap, stats.ActivePeers)
	}
}

// getConnectedBootstrapPeers returns currently connected bootstrap peers discovered via mDNS
func (s *mdnsNotifee) getConnectedBootstrapPeers() []peer.AddrInfo {
	s.discoveredLock.RLock()
	defer s.discoveredLock.RUnlock()

	var connected []peer.AddrInfo
	for _, peer := range s.discovered {
		if peer.IsBootstrap && peer.Connected {
			connected = append(connected, peer.AddrInfo)
		}
	}
	return connected
}

// Close stops the periodic refresh
func (s *mdnsNotifee) updateRegistryStats() {
	s.discoveredLock.RLock()
	defer s.discoveredLock.RUnlock()
	
	totalDiscovered := len(s.discovered)
	bootstrapDiscovered := 0
	connectedBootstrap := 0
	activePeers := make([]string, 0, totalDiscovered)
	
	for peerID, peer := range s.discovered {
		activePeers = append(activePeers, peerID.String())
		if peer.IsBootstrap {
			bootstrapDiscovered++
			if peer.Connected {
				connectedBootstrap++
			}
		}
	}
	
	s.registry.updateMDNSStats(totalDiscovered, bootstrapDiscovered, connectedBootstrap, activePeers)
}

func (s *mdnsNotifee) Close() {
	close(s.closeChan)
}
