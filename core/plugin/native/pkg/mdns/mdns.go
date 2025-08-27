package mdns

import (
	"context"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/mdns"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	multiaddr "github.com/multiformats/go-multiaddr"
)

// PeerDiscoveryCallback is called when a peer is discovered
type PeerDiscoveryCallback func(ctx context.Context, pi peer.AddrInfo, isBootstrap bool) error

// CallbackRegistration represents a component's callback registration
type CallbackRegistration struct {
	ComponentID   string
	PeerDiscovery PeerDiscoveryCallback
}

// Registry interface for callback operations (legacy compatibility)
type Registry interface {
	AddBootstrapNode(pi peer.AddrInfo)
	Register(ctx context.Context, pi peer.AddrInfo) error
}

// PeerInfo represents discovered peer information
type PeerInfo struct {
	AddrInfo        peer.AddrInfo
	IsBootstrap     bool
	Connected       bool
	FirstSeen       time.Time
	LastSeen        time.Time
	ConnectionTries int
}

// DiscoveryStats represents mDNS discovery statistics
type DiscoveryStats struct {
	TotalDiscovered     int
	BootstrapDiscovered int
	ConnectedBootstrap  int
	LastDiscoveryTime   time.Time
	ActivePeers         []string
}

// DiscoveredPeer represents a peer discovered via mDNS (legacy compatibility)
type DiscoveredPeer struct {
	AddrInfo     peer.AddrInfo
	DiscoveredAt time.Time
	LastSeen     time.Time
	Connected    bool
	IsBootstrap  bool
}

// Service represents the unified mDNS service for peer discovery (singleton)
type Service struct {
	host host.Host

	// Callback registrations
	callbacks   map[string]*CallbackRegistration
	callbacksMu sync.RWMutex

	// Legacy compatibility
	registry       Registry
	discoveredLock sync.RWMutex
	discovered     map[peer.ID]*DiscoveredPeer

	// Discovery and caching
	discoveredPeers map[peer.ID]*PeerInfo
	mu              sync.RWMutex

	// Bootstrap node management
	bootstrapNodes   []multiaddr.Multiaddr
	bootstrapNodesMu sync.RWMutex

	// Statistics
	stats   *DiscoveryStats
	statsMu sync.RWMutex

	// HashiCorp mDNS components
	server    *mdns.Server
	closeChan chan struct{}
	ticker    *time.Ticker

	// Periodic refresh
	refreshTicker   *time.Ticker
	refreshInterval time.Duration

	// Service configuration
	serviceType  string
	instanceName string
	port         int

	// Singleton management
	started bool
}

var (
	// Service instances per host and component
	services   map[string]*Service
	servicesMu sync.RWMutex
)

func init() {
	services = make(map[string]*Service)
}

// NewMDNSService returns a mDNS service instance for the given host
func NewMDNSService(h host.Host) *Service {
	return NewMDNSServiceWithComponent(h, "default")
}

// NewMDNSServiceWithComponent returns a mDNS service instance for the given host and component
func NewMDNSServiceWithComponent(h host.Host, componentID string) *Service {
	servicesMu.Lock()
	defer servicesMu.Unlock()

	serviceKey := fmt.Sprintf("%s-%s", h.ID().String(), componentID)
	if service, exists := services[serviceKey]; exists {
		return service
	}

	// Extract the actual port from the host's listening addresses
	port := extractPortFromHost(h)
	service := &Service{
		host:            h,
		callbacks:       make(map[string]*CallbackRegistration),
		discoveredPeers: make(map[peer.ID]*PeerInfo),
		discovered:      make(map[peer.ID]*DiscoveredPeer),
		bootstrapNodes:  make([]multiaddr.Multiaddr, 0),
		stats: &DiscoveryStats{
			ActivePeers: make([]string, 0),
		},
		closeChan:       make(chan struct{}),
		serviceType:     "_peers-touch._tcp",
		instanceName:    fmt.Sprintf("peers-touch-%s-%s", h.ID().String()[len(h.ID().String())-8:], componentID),
		port:            port,
		refreshInterval: 30 * time.Second,
		started:         false,
	}
	services[serviceKey] = service
	log.Printf("[mDNS] Initialized mDNS service with port: %d for host: %s, component: %s", port, h.ID().String()[:8], componentID)
	return service
}

// extractPortFromHost extracts the TCP port from the host's listening addresses
func extractPortFromHost(h host.Host) int {
	for _, addr := range h.Addrs() {
		addrStr := addr.String()
		// Look for TCP addresses
		if strings.Contains(addrStr, "/tcp/") {
			// Extract port number
			parts := strings.Split(addrStr, "/tcp/")
			if len(parts) > 1 {
				portParts := strings.Split(parts[1], "/")
				if len(portParts) > 0 {
					if port, err := strconv.Atoi(portParts[0]); err == nil {
						log.Printf("[mDNS] Extracted port %d from address: %s", port, addrStr)
						return port
					}
				}
			}
		}
	}
	// Fallback to default port if no TCP address found
	log.Printf("[mDNS] No TCP port found in host addresses, using default port 4001")
	return 4001
}

// RegisterCallback registers a component's callback functions
func (s *Service) RegisterCallback(registration *CallbackRegistration) {
	s.callbacksMu.Lock()
	defer s.callbacksMu.Unlock()
	s.callbacks[registration.ComponentID] = registration
	log.Printf("[mDNS] Registered mDNS callbacks for component: %s", registration.ComponentID)
}

// UnregisterCallback removes a component's callback functions
func (s *Service) UnregisterCallback(componentID string) {
	s.callbacksMu.Lock()
	defer s.callbacksMu.Unlock()
	delete(s.callbacks, componentID)
	log.Printf("[mDNS] Unregistered mDNS callbacks for component: %s", componentID)
}

// Start initializes and starts the mDNS service
func (s *Service) Start() error {
	if s.started {
		log.Printf("[mDNS] mDNS service already started")
		return nil
	}

	if err := s.startMDNSService(); err != nil {
		return fmt.Errorf("failed to start mDNS service: %w", err)
	}

	// Start periodic discovery
	s.ticker = time.NewTicker(30 * time.Second)
	go s.periodicDiscovery()

	// Start periodic refresh of connections
	go s.periodicRefresh()

	s.started = true
	log.Printf("[mDNS] mDNS service started successfully")
	return nil
}

// startMDNSService initializes the HashiCorp mDNS server
func (s *Service) startMDNSService() error {
	// Get local addresses for the service
	addresses := s.getLocalAddresses()
	if len(addresses) == 0 {
		return fmt.Errorf("no valid local addresses found")
	}

	// Create service info with size limits to avoid DNS TXT record 255-byte limit
	info := []string{
		fmt.Sprintf("peer_id=%s", s.host.ID().String()),
		fmt.Sprintf("port=%d", s.port),
	}

	// Add addresses but limit total TXT record size
	// DNS TXT records have a 255-byte limit, so we need to be careful
	addressesStr := strings.Join(addresses, ",")
	if len(addressesStr) > 200 { // Leave room for other fields
		// Take only the first few addresses that fit
		var limitedAddresses []string
		currentLength := 0
		for _, addr := range addresses {
			if currentLength+len(addr)+1 > 200 { // +1 for comma
				break
			}
			limitedAddresses = append(limitedAddresses, addr)
			currentLength += len(addr) + 1
		}
		addressesStr = strings.Join(limitedAddresses, ",")
		log.Printf("[mDNS] Limited addresses to %d entries to avoid TXT record size limit", len(limitedAddresses))
	}

	if len(addressesStr) > 0 {
		info = append(info, fmt.Sprintf("addresses=%s", addressesStr))
	}

	// Create mDNS service
	service, err := mdns.NewMDNSService(
		s.instanceName,
		s.serviceType,
		"", // domain (empty for .local)
		"", // host (empty to use hostname)
		s.port,
		nil, // IPs (will be auto-detected)
		info,
	)
	if err != nil {
		return fmt.Errorf("failed to create mDNS service: %w", err)
	}

	// Create and start mDNS server
	server, err := mdns.NewServer(&mdns.Config{Zone: service})
	if err != nil {
		return fmt.Errorf("failed to create mDNS server: %w", err)
	}

	s.server = server
	return nil
}

// getLocalAddresses returns the local addresses for mDNS service
func (s *Service) getLocalAddresses() []string {
	var addresses []string

	// Get addresses from libp2p host
	for _, addr := range s.host.Addrs() {
		// Convert to string and filter out loopback and link-local
		addrStr := addr.String()
		if !strings.Contains(addrStr, "127.0.0.1") && !strings.Contains(addrStr, "::1") {
			addresses = append(addresses, addrStr)
		}
	}

	// If no addresses from libp2p, get system interfaces
	if len(addresses) == 0 {
		interfaces, err := net.Interfaces()
		if err == nil {
			for _, iface := range interfaces {
				if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
					continue
				}
				addrs, err := iface.Addrs()
				if err != nil {
					continue
				}
				for _, addr := range addrs {
					if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
						if ipnet.IP.To4() != nil {
							addresses = append(addresses, fmt.Sprintf("/ip4/%s/tcp/%d", ipnet.IP.String(), s.port))
						}
					}
				}
			}
		}
	}

	return addresses
}

// periodicDiscovery runs periodic peer discovery
func (s *Service) periodicDiscovery() {
	for {
		select {
		case <-s.ticker.C:
			s.discoverPeers()
		case <-s.closeChan:
			return
		}
	}
}

// discoverPeers performs mDNS discovery for peers
func (s *Service) discoverPeers() {
	log.Printf("[mDNS] Starting mDNS peer discovery...")

	// Create entries channel
	entriesCh := make(chan *mdns.ServiceEntry, 10)

	// Start discovery
	go func() {
		defer close(entriesCh)
		params := &mdns.QueryParam{
			Service: s.serviceType,
			Domain:  "local",
			Timeout: 5 * time.Second,
			Entries: entriesCh,
		}
		if err := mdns.Query(params); err != nil {
			log.Printf("[mDNS] mDNS query failed: %v", err)
		}
	}()

	// Process discovered entries
	for entry := range entriesCh {
		s.handleDiscoveredEntry(entry)
	}

	log.Printf("[mDNS] mDNS discovery completed")
}

// handleDiscoveredEntry processes a discovered mDNS entry
func (s *Service) handleDiscoveredEntry(entry *mdns.ServiceEntry) {
	// Skip our own service
	if entry.Name == s.instanceName+"."+s.serviceType+".local." {
		return
	}

	// Parse TXT records for peer information
	var peerIDStr string
	var addresses []string
	var port int

	for _, txt := range entry.InfoFields {
		if strings.HasPrefix(txt, "peer_id=") {
			peerIDStr = strings.TrimPrefix(txt, "peer_id=")
		} else if strings.HasPrefix(txt, "addresses=") {
			addressesStr := strings.TrimPrefix(txt, "addresses=")
			addresses = strings.Split(addressesStr, ",")
		} else if strings.HasPrefix(txt, "port=") {
			portStr := strings.TrimPrefix(txt, "port=")
			if p, err := strconv.Atoi(portStr); err == nil {
				port = p
			}
		}
	}

	if peerIDStr == "" {
		log.Printf("[mDNS] No peer_id found in mDNS entry")
		return
	}

	// Parse peer ID
	peerID, err := peer.Decode(peerIDStr)
	if err != nil {
		log.Printf("[mDNS] Invalid peer ID in mDNS entry: %v", err)
		return
	}

	// Skip self
	if peerID == s.host.ID() {
		return
	}

	// Create multiaddresses
	var multiaddrs []multiaddr.Multiaddr
	for _, addrStr := range addresses {
		if addr, err := multiaddr.NewMultiaddr(addrStr); err == nil {
			multiaddrs = append(multiaddrs, addr)
		}
	}

	// Add entry address if not in addresses list
	if entry.AddrV4 != nil && port > 0 {
		if addr, err := multiaddr.NewMultiaddr(fmt.Sprintf("/ip4/%s/tcp/%d", entry.AddrV4.String(), port)); err == nil {
			multiaddrs = append(multiaddrs, addr)
		}
	}

	if len(multiaddrs) == 0 {
		log.Printf("[mDNS] No valid addresses found for peer %s", peerID.String())
		return
	}

	// Create peer info
	pi := peer.AddrInfo{
		ID:    peerID,
		Addrs: multiaddrs,
	}

	// Check if this is likely a bootstrap server
	isBootstrap := s.isLikelyBootstrapServer(pi)

	log.Printf("[mDNS] Discovered peer via mDNS: %s (bootstrap: %v)", peerID.String(), isBootstrap)
	s.HandlePeerFoundWithBootstrap(pi, isBootstrap)
}

// HandlePeerFound handles discovered peers from mDNS
func (s *Service) HandlePeerFound(pi peer.AddrInfo) {
	// Determine if this is likely a bootstrap server based on port analysis
	isBootstrap := s.isLikelyBootstrapServer(pi)
	s.HandlePeerFoundWithBootstrap(pi, isBootstrap)
}

// HandlePeerFoundWithBootstrap handles a discovered peer with bootstrap detection
func (s *Service) HandlePeerFoundWithBootstrap(pi peer.AddrInfo, isBootstrap bool) {
	ctx := context.Background()
	now := time.Now()

	// Update unified peer info
	s.mu.Lock()
	if existing, exists := s.discoveredPeers[pi.ID]; exists {
		existing.LastSeen = now
		existing.AddrInfo = pi // Update addresses
		existing.IsBootstrap = isBootstrap
	} else {
		s.discoveredPeers[pi.ID] = &PeerInfo{
			AddrInfo:        pi,
			IsBootstrap:     isBootstrap,
			Connected:       false,
			FirstSeen:       now,
			LastSeen:        now,
			ConnectionTries: 0,
		}
	}
	s.mu.Unlock()

	// Update legacy compatibility structure
	s.discoveredLock.Lock()
	if existing, exists := s.discovered[pi.ID]; exists {
		existing.LastSeen = now
		existing.AddrInfo = pi
		existing.IsBootstrap = isBootstrap
	} else {
		s.discovered[pi.ID] = &DiscoveredPeer{
			AddrInfo:     pi,
			DiscoveredAt: now,
			LastSeen:     now,
			Connected:    false,
			IsBootstrap:  isBootstrap,
		}
	}
	s.discoveredLock.Unlock()

	// Call registered callbacks
	s.callbacksMu.RLock()
	for componentID, callback := range s.callbacks {
		if callback.PeerDiscovery != nil {
			go func(cb PeerDiscoveryCallback, id string) {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[mDNS] Peer discovery callback panic for %s: %v", id, r)
					}
				}()
				if err := cb(ctx, pi, isBootstrap); err != nil {
					log.Printf("[mDNS] Peer discovery callback error for %s: %v", id, err)
				}
			}(callback.PeerDiscovery, componentID)
		}
	}
	s.callbacksMu.RUnlock()

	// Legacy compatibility: use registry if available and no callbacks registered
	if s.registry != nil {
		if isBootstrap {
			log.Printf("[mDNS] Adding bootstrap node: %s", pi.ID.String())
			s.registry.AddBootstrapNode(pi)
			go s.connectToBootstrapPeer(ctx, pi)
		}
		go s.registry.Register(ctx, pi)
	}

	// Update statistics
	go s.updateStats()
}

// isLikelyBootstrapServer determines if a discovered peer is likely a bootstrap server
func (s *Service) isLikelyBootstrapServer(pi peer.AddrInfo) bool {
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

	return false
}

// connectToBootstrapPeer attempts to connect to a bootstrap peer
func (s *Service) connectToBootstrapPeer(ctx context.Context, pi peer.AddrInfo) {
	if s.host.Network().Connectedness(pi.ID) == network.Connected {
		s.updateConnectionStatus(pi.ID, true)
		return
	}

	// Increment connection tries
	s.mu.Lock()
	if peerInfo, exists := s.discoveredPeers[pi.ID]; exists {
		peerInfo.ConnectionTries++
	}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := s.host.Connect(ctx, pi); err != nil {
		log.Printf("[mDNS] Failed to connect to bootstrap peer %s (attempt %d): %v", pi.ID.String(), s.getConnectionTries(pi.ID), err)
		s.updateConnectionStatus(pi.ID, false)
	} else {
		log.Printf("[mDNS] Successfully connected to bootstrap peer: %s", pi.ID.String())
		s.updateConnectionStatus(pi.ID, true)
	}
}

// getConnectionTries returns the number of connection attempts for a peer
func (s *Service) getConnectionTries(peerID peer.ID) int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if peerInfo, exists := s.discoveredPeers[peerID]; exists {
		return peerInfo.ConnectionTries
	}
	return 0
}

// updateConnectionStatus updates the connection status of a discovered peer
func (s *Service) updateConnectionStatus(peerID peer.ID, connected bool) {
	// Update unified peer info
	s.mu.Lock()
	if peerInfo, exists := s.discoveredPeers[peerID]; exists {
		peerInfo.Connected = connected
	}
	s.mu.Unlock()

	// Update legacy compatibility structure
	s.discoveredLock.Lock()
	if peer, exists := s.discovered[peerID]; exists {
		peer.Connected = connected
	}
	s.discoveredLock.Unlock()

	// Update statistics
	go s.updateStats()
}

// periodicRefresh runs periodic connection refresh
func (s *Service) periodicRefresh() {
	refreshTicker := time.NewTicker(2 * time.Minute)
	defer refreshTicker.Stop()

	for {
		select {
		case <-refreshTicker.C:
			s.refreshConnections()
		case <-s.closeChan:
			return
		}
	}
}

// refreshConnections checks and maintains connections to discovered bootstrap peers
func (s *Service) refreshConnections() {
	ctx := context.Background()
	log.Printf("[mDNS] Starting connection refresh...")
	now := time.Now()

	s.discoveredLock.Lock()
	log.Printf("[mDNS] Discovered peers count: %d", len(s.discovered))

	for peerID, peer := range s.discovered {
		// Remove peers not seen for more than 5 minutes
		if now.Sub(peer.LastSeen) > 5*time.Minute {
			log.Printf("[mDNS] Removing stale peer: %s (last seen: %v ago)", peerID.String(), now.Sub(peer.LastSeen))
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
				log.Printf("[mDNS] Bootstrap peer %s is now connected", peerID.String())
				peer.Connected = true
			}
		} else {
			if peer.Connected {
				log.Printf("[mDNS] Bootstrap peer %s disconnected, attempting reconnect", peerID.String())
				peer.Connected = false
			}
			// Try to reconnect
			go s.connectToBootstrapPeer(ctx, peer.AddrInfo)
		}
	}

	s.discoveredLock.Unlock()
	log.Printf("[mDNS] Finished processing discovered peers")
}

// GetConnectedBootstrapPeers returns currently connected bootstrap peers
func (s *Service) GetConnectedBootstrapPeers() []peer.AddrInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var connected []peer.AddrInfo
	for _, peerInfo := range s.discoveredPeers {
		if peerInfo.IsBootstrap && peerInfo.Connected {
			connected = append(connected, peerInfo.AddrInfo)
		}
	}
	return connected
}

// GetDiscoveredPeers returns all discovered peers
func (s *Service) GetDiscoveredPeers() map[peer.ID]*PeerInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Return a copy to avoid race conditions
	result := make(map[peer.ID]*PeerInfo)
	for id, peerInfo := range s.discoveredPeers {
		// Deep copy the peer info
		copiedPeer := &PeerInfo{
			AddrInfo:        peerInfo.AddrInfo,
			IsBootstrap:     peerInfo.IsBootstrap,
			Connected:       peerInfo.Connected,
			FirstSeen:       peerInfo.FirstSeen,
			LastSeen:        peerInfo.LastSeen,
			ConnectionTries: peerInfo.ConnectionTries,
		}
		result[id] = copiedPeer
	}
	return result
}

// GetStats returns current discovery statistics
func (s *Service) GetStats() DiscoveryStats {
	s.statsMu.RLock()
	defer s.statsMu.RUnlock()

	// Create a copy to avoid race conditions
	stats := *s.stats
	stats.ActivePeers = make([]string, len(s.stats.ActivePeers))
	copy(stats.ActivePeers, s.stats.ActivePeers)

	return stats
}

// updateStats updates discovery statistics
func (s *Service) updateStats() {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	s.mu.RLock()
	defer s.mu.RUnlock()

	s.stats.TotalDiscovered = len(s.discoveredPeers)
	s.stats.BootstrapDiscovered = 0
	s.stats.ConnectedBootstrap = 0
	s.stats.ActivePeers = make([]string, 0, len(s.discoveredPeers))

	for peerID, peerInfo := range s.discoveredPeers {
		s.stats.ActivePeers = append(s.stats.ActivePeers, peerID.String())
		if peerInfo.IsBootstrap {
			s.stats.BootstrapDiscovered++
			if peerInfo.Connected {
				s.stats.ConnectedBootstrap++
			}
		}
	}

	s.stats.LastDiscoveryTime = time.Now()
}

// AddBootstrapNode adds a bootstrap node to the list
func (s *Service) AddBootstrapNode(addr multiaddr.Multiaddr) {
	s.bootstrapNodesMu.Lock()
	defer s.bootstrapNodesMu.Unlock()

	// Check if already exists
	for _, existing := range s.bootstrapNodes {
		if existing.Equal(addr) {
			return
		}
	}

	s.bootstrapNodes = append(s.bootstrapNodes, addr)
	log.Printf("[mDNS] Added bootstrap node: %s", addr.String())
}

// GetBootstrapNodes returns the list of bootstrap nodes
func (s *Service) GetBootstrapNodes() []multiaddr.Multiaddr {
	s.bootstrapNodesMu.RLock()
	defer s.bootstrapNodesMu.RUnlock()

	// Return a copy
	nodes := make([]multiaddr.Multiaddr, len(s.bootstrapNodes))
	copy(nodes, s.bootstrapNodes)
	return nodes
}

// ClearCache clears the discovered peers cache
func (s *Service) ClearCache() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.discoveredLock.Lock()
	defer s.discoveredLock.Unlock()

	s.discoveredPeers = make(map[peer.ID]*PeerInfo)
	s.discovered = make(map[peer.ID]*DiscoveredPeer)
	log.Printf("[mDNS] Cleared mDNS peer cache")
}

// StartPeriodicRefresh starts the periodic refresh of discovered peers
func (s *Service) StartPeriodicRefresh() {
	if s.refreshTicker != nil {
		return // Already started
	}

	s.refreshTicker = time.NewTicker(s.refreshInterval)
	go s.periodicRefreshLoop()
}

// periodicRefreshLoop periodically checks peer connectivity and refreshes the cache
func (s *Service) periodicRefreshLoop() {
	for {
		select {
		case <-s.refreshTicker.C:
			s.refreshPeers()
		case <-s.closeChan:
			if s.refreshTicker != nil {
				s.refreshTicker.Stop()
			}
			return
		}
	}
}

// refreshPeers checks the connectivity of discovered peers
func (s *Service) refreshPeers() {
	ctx := context.Background()
	s.mu.Lock()
	peersToCheck := make([]*PeerInfo, 0, len(s.discoveredPeers))
	for _, peerInfo := range s.discoveredPeers {
		peersToCheck = append(peersToCheck, peerInfo)
	}
	s.mu.Unlock()

	for _, peerInfo := range peersToCheck {
		// Check if we have an active connection
		connected := s.host.Network().Connectedness(peerInfo.AddrInfo.ID) == network.Connected
		if connected != peerInfo.Connected {
			s.updateConnectionStatus(peerInfo.AddrInfo.ID, connected)
			log.Printf("[mDNS] Peer %s connectivity changed: %v", peerInfo.AddrInfo.ID.String(), connected)
		}

		// Try to reconnect to bootstrap peers if disconnected
		if peerInfo.IsBootstrap && !connected && peerInfo.ConnectionTries < 3 {
			go s.connectToBootstrapPeer(ctx, peerInfo.AddrInfo)
		}
	}

	// Update statistics after refresh
	s.updateStats()
}

// GetAlivePeerAddrs returns addresses of currently connected peers
func (s *Service) GetAlivePeerAddrs() []multiaddr.Multiaddr {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var addrs []multiaddr.Multiaddr
	for _, peerInfo := range s.discoveredPeers {
		if peerInfo.Connected {
			addrs = append(addrs, peerInfo.AddrInfo.Addrs...)
		}
	}

	return addrs
}

// Close stops the mDNS service
func (s *Service) Close() {
	if !s.started {
		return
	}

	if s.closeChan != nil {
		close(s.closeChan)
	}
	if s.ticker != nil {
		s.ticker.Stop()
	}
	if s.refreshTicker != nil {
		s.refreshTicker.Stop()
	}
	if s.server != nil {
		s.server.Shutdown()
	}

	// Clear callbacks
	s.callbacksMu.Lock()
	s.callbacks = make(map[string]*CallbackRegistration)
	s.callbacksMu.Unlock()

	s.started = false
	log.Printf("[mDNS] mDNS service stopped")
}

// CloseAllServices safely closes all mDNS services
func CloseAllServices() {
	servicesMu.Lock()
	defer servicesMu.Unlock()

	for serviceKey, service := range services {
		if service != nil {
			service.Close()
		}
		delete(services, serviceKey)
	}
}

// CloseServiceForHost closes the mDNS service for a specific host
func CloseServiceForHost(hostID peer.ID) {
	servicesMu.Lock()
	defer servicesMu.Unlock()

	// Close all services for this host (all components)
	for serviceKey, service := range services {
		if strings.HasPrefix(serviceKey, hostID.String()+"-") {
			if service != nil {
				service.Close()
			}
			delete(services, serviceKey)
		}
	}
}

// CloseServiceForHostAndComponent closes the mDNS service for a specific host and component
func CloseServiceForHostAndComponent(hostID peer.ID, componentID string) {
	servicesMu.Lock()
	defer servicesMu.Unlock()

	serviceKey := fmt.Sprintf("%s-%s", hostID.String(), componentID)
	if service, exists := services[serviceKey]; exists {
		service.Close()
		delete(services, serviceKey)
	}
}
