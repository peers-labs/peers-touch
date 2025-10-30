package mdns

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/mdns"
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/types"
)

// Default constants following project conventions
const (
	// DefaultService is the default mDNS service type
	DefaultService = "_peers-touch._tcp"

	// DefaultDomain is the default mDNS domain
	DefaultDomain = "local."

	// DefaultPort is the default mDNS port
	DefaultPort = 5353

	// DefaultDiscoveryInterval is the default discovery interval
	DefaultDiscoveryInterval = 30 * time.Second

	// DefaultTimeout is the default timeout for mDNS operations
	DefaultTimeout = 5 * time.Second

	// DefaultNetworkType is the default network type
	DefaultNetworkType = "mdns"
)

// Service represents an mDNS service for peer discovery
type Service struct {
	options Options
	ctx     context.Context
	cancel  context.CancelFunc

	// Discovery callback
	onPeerDiscovered func(*types.Peer)

	// Internal state
	running bool
	mu      sync.RWMutex

	// mDNS components
	server  *mdns.Server
	entries chan *mdns.ServiceEntry

	// Discovery management
	discoveryTicker *time.Ticker
	wg              sync.WaitGroup
}

// NewMDNSService creates a new mDNS service with the given options
func NewMDNSService(ctx context.Context, opts ...Option) (*Service, error) {
	// Start with default configuration
	config := DefaultServiceConfig()

	// Apply user options
	config = ApplyOptions(config, opts...)

	// Validate required fields
	if config.Namespace == "" {
		return nil, fmt.Errorf("mDNS namespace name is required")
	}

	// Set defaults for optional fields
	if config.Service == "" {
		config.Service = DefaultService
	}
	
	// Only use dynamic domain generation if Domain is the default "local." and wasn't explicitly set
	if config.Domain == DefaultDomain {
		// Generate dynamic domain based on namespace for better isolation
		config.Domain = generateDynamicDomain(config.Namespace)
	}
	
	if config.Port == 0 {
		config.Port = DefaultPort
	}
	if config.DiscoveryInterval == 0 {
		config.DiscoveryInterval = DefaultDiscoveryInterval
	}

	// Create service context
	serviceCtx, cancel := context.WithCancel(ctx)

	s := &Service{
		options: config,
		ctx:     serviceCtx,
		cancel:  cancel,
		entries: make(chan *mdns.ServiceEntry, 10),
	}

	return s, nil
}

// Start starts the mDNS service
func (s *Service) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return fmt.Errorf("mDNS service already running")
	}

	// Start mDNS server for service advertisement
	if err := s.startMDNSServer(); err != nil {
		return fmt.Errorf("failed to start mDNS server: %w", err)
	}

	// Start discovery
	s.startDiscovery()

	s.running = true
	logger.Infof(s.ctx, "[mDNS] Service started: %s.%s", s.options.Service, s.options.Domain)

	return nil
}

// Stop stops the mDNS service
func (s *Service) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return fmt.Errorf("mDNS service not running")
	}

	// Cancel context
	s.cancel()

	// Stop discovery
	if s.discoveryTicker != nil {
		s.discoveryTicker.Stop()
	}

	// Stop mDNS server
	if s.server != nil {
		if err := s.server.Shutdown(); err != nil {
			logger.Errorf(s.ctx, "[mDNS] Error shutting down server: %v", err)
		}
	}

	// Wait for goroutines to finish
	s.wg.Wait()

	s.running = false
	logger.Infof(s.ctx, "[mDNS] Service stopped")

	return nil
}

// startMDNSServer starts the mDNS server for service advertisement
func (s *Service) startMDNSServer() error {
	// Use a default port if not specified
	port := 5353 // mDNS standard port
	if s.options.Port > 0 {
		port = s.options.Port
	}

	// Create mDNS service
	service, err := mdns.NewMDNSService(
		s.options.Namespace,
		s.options.Service,
		s.options.Domain,
		s.options.HostName,
		port,
		s.options.IPs,
		s.options.TXT,
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

// startDiscovery starts the discovery process
func (s *Service) startDiscovery() {
	// Create discovery ticker
	s.discoveryTicker = time.NewTicker(s.options.DiscoveryInterval)

	// Start discovery goroutine
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()

		// Run initial discovery
		s.performDiscovery()

		// Periodic discovery
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-s.discoveryTicker.C:
				s.performDiscovery()
			}
		}
	}()
}

// performDiscovery performs mDNS discovery with proper goroutine tracking and context awareness
func (s *Service) performDiscovery() {
	logger.Infof(s.ctx, "[mDNS] Starting discovery for: %s.%s", s.options.Service, s.options.Domain)

	// Create entries channel for this discovery
	entriesCh := make(chan *mdns.ServiceEntry, 10)

	// Track this discovery goroutine with WaitGroup to ensure proper cleanup
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer close(entriesCh)

		params := &mdns.QueryParam{
			Service: s.options.Service,
			Domain:  s.options.Domain,
			Timeout: DefaultTimeout,
			Entries: entriesCh,
		}

		if err := mdns.Query(params); err != nil {
			logger.Errorf(s.ctx, "[mDNS] Discovery query failed: %v", err)
		}
	}()

	// Process discovered entries with context awareness to handle shutdown gracefully
	for {
		select {
		case entry, ok := <-entriesCh:
			if !ok {
				// Channel closed, discovery complete
				logger.Infof(s.ctx, "[mDNS] Discovery completed for: %s.%s", s.options.Service, s.options.Domain)
				return
			}
			if entry == nil {
				continue
			}

			// Skip self (check by namespace)
			if entry.Name == s.options.Namespace+"."+s.options.Service+"."+s.options.Domain {
				continue
			}

			// Convert to peer and call callback
			peer := s.entryToPeer(entry)
			if peer != nil && s.onPeerDiscovered != nil {
				s.onPeerDiscovered(peer)
			}

		case <-s.ctx.Done():
			// Service is shutting down, exit gracefully
			logger.Infof(s.ctx, "[mDNS] Discovery interrupted due to shutdown for: %s.%s", s.options.Service, s.options.Domain)
			return
		}
	}
}

// Watch sets a callback for peer discovery
func (s *Service) Watch(callback func(*types.Peer)) {
	s.onPeerDiscovered = callback
	logger.Infof(s.ctx, "[mDNS] Discovery callback registered")
}

// AdvertiseNode advertises a node via mDNS
func (s *Service) AdvertiseNode(node *types.Node) error {
	if node == nil {
		return fmt.Errorf("node cannot be nil")
	}

	// Build TXT records from node information
	txtRecords := s.buildTXTRecords(node)

	// Update service TXT records
	s.options.TXT = txtRecords

	// If service is already running, restart with new configuration
	s.mu.RLock()
	running := s.running
	s.mu.RUnlock()

	if running {
		logger.Infof(s.ctx, "[mDNS] Restarting service with new node configuration: %s", node.ID)
		if err := s.Stop(); err != nil {
			return fmt.Errorf("failed to stop service for reconfiguration: %w", err)
		}
		return s.Start()
	}

	logger.Infof(s.ctx, "[mDNS] Node configured for advertisement: %s (type: %s, port: %d)", node.ID, node.Type, node.Port)
	return nil
}

// buildTXTRecords builds mDNS TXT records from node information
// Uses compressed field names to minimize DNS TXT record size:
// - nd_id: node ID (critical for peer identification)
// - nd_tp: node type (required for service filtering)
// - nd_nm: node name (for display/logging)
// - nt_id: network ID (required for network identification)
// - nd_pt: node port (essential for connection establishment)
// - addrs: network addresses (limited to ~200 bytes to fit DNS constraints)
func (s *Service) buildTXTRecords(node *types.Node) []string {
	var txt []string

	// Add node ID (critical field - always include)
	if node.ID != "" {
		txt = append(txt, fmt.Sprintf("nd_id=%s", node.ID))
	}

	// Add node type (critical field - required for service type filtering)
	if node.Type != "" {
		txt = append(txt, fmt.Sprintf("nd_tp=%s", node.Type))
	}

	// Add node name (important field - used for display and logging)
	if node.Name != "" {
		txt = append(txt, fmt.Sprintf("nd_nm=%s", node.Name))
	}

	// Add network ID if available (critical field - required for network identification)
	if node.NetworkID != nil {
		txt = append(txt, fmt.Sprintf("nt_id=%s", node.NetworkID.String()))
	}

	// Add port (critical field - essential for connection establishment)
	if node.Port > 0 {
		txt = append(txt, fmt.Sprintf("nd_pt=%d", node.Port))
	}

	// Add addresses with size limit (important field - limited to fit DNS constraints)
	if len(node.Addresses) > 0 {
		addressesStr := strings.Join(node.Addresses, ",")

		// DNS TXT records have a 255-byte limit per string, but we need to be conservative
		// to leave room for other fields. Limit to ~200 bytes for the addresses field.
		if len(addressesStr) > 200 {
			// Take only the first few addresses that fit
			var limitedAddresses []string
			currentLength := 0
			for _, addr := range node.Addresses {
				if currentLength+len(addr)+1 > 200 { // +1 for comma
					break
				}
				limitedAddresses = append(limitedAddresses, addr)
				currentLength += len(addr) + 1
			}
			addressesStr = strings.Join(limitedAddresses, ",")
			logger.Infof(s.ctx, "[mDNS] Limited addresses to %d entries to avoid TXT record size limit", len(limitedAddresses))
		}

		if len(addressesStr) > 0 {
			txt = append(txt, fmt.Sprintf("addrs=%s", addressesStr))
		}
	}

	// Validate total size to avoid DNS packet overflow (typical limit ~512 bytes for UDP)
	// Be conservative and limit total TXT records to ~400 bytes
	totalSize := 0
	for _, record := range txt {
		totalSize += len(record) + 1 // +1 for separator
	}

	if totalSize > 400 {
		logger.Warnf(s.ctx, "[mDNS] Warning: Total TXT record size (%d bytes) approaching DNS packet limit", totalSize)
		// In a production system, you might want to prioritize or drop less important fields
	}

	return txt
}

// generateDynamicDomain creates concise domain from namespace
func generateDynamicDomain(namespace string) string {
	// Standard namespaces use standard local domain for compatibility
	if namespace == "peers-touch" || namespace == "default" || namespace == "" {
		return "local."
	}
	
	// Short namespace (max 6 chars) for subdomain
	short := namespace
	if len(namespace) > 6 {
		short = namespace[:6]
	}
	
	// Keep only alphanumeric, lowercase
	var result strings.Builder
	for _, ch := range strings.ToLower(short) {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			result.WriteRune(ch)
		}
	}
	
	if result.Len() < 3 {
		return "local." // Invalid, fallback
	}
	
	return result.String() + ".local."
}

// entryToPeer converts mDNS entry to peer format
func (s *Service) entryToPeer(entry *mdns.ServiceEntry) *types.Peer {
	// Parse TXT records
	nodeInfo := s.parseTXTRecords(entry.InfoFields)

	// Create peer from node info
	if nodeInfo["node_id"] == "" {
		return nil // Skip entries without node ID
	}

	// Create addresses from entry info
	var addresses []string
	if entry.AddrV4 != nil {
		// Use node port from TXT records, not mDNS service port
		nodePort := entry.Port
		if portStr := nodeInfo["node_port"]; portStr != "" {
			// For now, use the port as-is (in real implementation, validate it)
			nodePort = entry.Port // Keep mDNS port for now
		}
		addresses = append(addresses, fmt.Sprintf("/ip4/%s/tcp/%d", entry.AddrV4.String(), nodePort))
	}
	if entry.AddrV6 != nil {
		nodePort := entry.Port
		if portStr := nodeInfo["node_port"]; portStr != "" {
			nodePort = entry.Port // Keep mDNS port for now
		}
		addresses = append(addresses, fmt.Sprintf("/ip6/%s/tcp/%d", entry.AddrV6.String(), nodePort))
	}

	// Create peer
	p := &types.Peer{
		ID:        nodeInfo["node_id"],
		Name:      nodeInfo["node_name"],
		Version:   "1.0.0", // Default version
		Nodes:     []types.Node{},
		Metadata:  make(map[string]interface{}),
		Timestamp: time.Now(),
	}

	// Set network ID if available
	if nodeInfo["network_id"] != "" {
		// For now, create a simple network ID (in real implementation, parse it properly)
		p.NetworkID = &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypePeer,
			Hash:    []byte(nodeInfo["network_id"])[:20], // Take first 20 bytes
		}
	}

	// Add node information
	if nodeInfo["node_type"] != "" {
		node := types.Node{
			ID:        nodeInfo["node_id"],
			Type:      nodeInfo["node_type"],
			Name:      nodeInfo["node_name"],
			Port:      0, // Will be set from TXT records
			NetworkID: p.NetworkID,
			Metadata:  make(map[string]interface{}),
		}

		// Set port from TXT records
		if portStr := nodeInfo["node_port"]; portStr != "" {
			// Simple port parsing (in real implementation, validate properly)
			node.Port = entry.Port // Use mDNS port for now
		}

		// Add addresses from parsed info
		if nodeInfo["addresses"] != "" {
			node.Addresses = strings.Split(nodeInfo["addresses"], ",")
		}

		p.Nodes = append(p.Nodes, node)
	}

	// Add discovery metadata
	p.Metadata["mdns_discovered"] = true
	p.Metadata["mdns_entry_name"] = entry.Name
	p.Metadata["mdns_discovery_time"] = time.Now().Unix()
	p.Metadata["network_type"] = DefaultNetworkType
	p.Metadata["network_id_str"] = entry.Name
	p.Metadata["addresses"] = addresses

	return p
}

// parseTXTRecords parses mDNS TXT records
// Supports both old format (node_id, node_type, etc.) and new compressed format (nd_id, nd_tp, etc.)
func (s *Service) parseTXTRecords(txtFields []string) map[string]string {
	info := make(map[string]string)

	for _, field := range txtFields {
		parts := strings.SplitN(field, "=", 2)
		if len(parts) == 2 {
			key := parts[0]
			value := parts[1]

			// Map compressed field names to standard names for backward compatibility
			switch key {
			case "nd_id":
				info["node_id"] = value
			case "nd_tp":
				info["node_type"] = value
			case "nd_nm":
				info["node_name"] = value
			case "nt_id":
				info["network_id"] = value
			case "nd_pt":
				info["node_port"] = value
			case "addrs":
				info["addresses"] = value
			default:
				// Keep original key for backward compatibility and future extensions
				info[key] = value
			}
		}
	}

	return info
}
