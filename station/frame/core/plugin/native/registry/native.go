package native

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/ipfs/boxo/ipns"
	"github.com/ipfs/go-cid"
	log "github.com/ipfs/go-log/v2"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	record "github.com/libp2p/go-libp2p-record"
	"github.com/libp2p/go-libp2p/core/crypto/pb"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/multiformats/go-multihash"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin/native/internal/mdns"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"github.com/peers-touch/peers-touch/station/frame/core/types"
	"github.com/pion/turn/v4"
)

var (
	_ registry.Registry = &nativeRegistry{}
)

var (
	// keep be a singleton
	regInstance registry.Registry
	regOnce     sync.RWMutex
)

type mdnsDiscoveryStats struct {
	TotalDiscovered     int
	BootstrapDiscovered int
	ConnectedBootstrap  int
	LastDiscoveryTime   time.Time
	ActivePeers         []string
}

type nativeRegistry struct {
	options *registry.Options
	// extended options
	extOpts *options

	store store.Store
	peers map[string]*Peer
	mu    sync.RWMutex

	host        host.Host
	dht         *dht.IpfsDHT
	mdnsService *mdns.Service

	turn               *turnClient
	turnUpdateLock     sync.Mutex
	turnUpdateTime     time.Time
	turnStunAddresses  []string
	turnRelayAddresses []string

	// bootstrap nodes status - removed, no longer needed

	// mDNS discovered bootstrap nodes (separate from configured ones)
	mdnsBootstrapLock            sync.RWMutex
	mdnsDiscoveredBootstrapNodes []multiaddr.Multiaddr

	// mDNS discovery statistics
	mdnsStatsLock sync.RWMutex
	mdnsStats     *mdnsDiscoveryStats
}

func NewRegistry(opts ...option.Option) registry.Registry {
	regOnce.Lock()
	defer regOnce.Unlock()

	if regInstance != nil {
		return regInstance
	}

	regInstance = &nativeRegistry{
		peers:   make(map[string]*Peer),
		options: registry.GetPluginRegions(opts...),
		// bootstrapNodesStatus initialization removed
		mdnsDiscoveredBootstrapNodes: make([]multiaddr.Multiaddr, 0),
		mdnsStats: &mdnsDiscoveryStats{
			ActivePeers: make([]string, 0),
		},
	}

	return regInstance
}

func (r *nativeRegistry) Init(ctx context.Context, opts ...option.Option) error {
	r.options.Apply(opts...)
	r.extOpts = r.options.ExtOptions.(*options)

	if r.options.Store == nil {
		return errors.New("store is required for native registry. ")
	}
	r.store = r.options.Store

	// Set the logging level to Warn
	err := log.SetLogLevel("dht", "debug")
	if err != nil {
		panic(err)
	}

	if r.options.PrivateKey == "" {
		return errors.New("private key for Registry is required")
	}

	if err = r.autoMigrate(ctx); err != nil {
		return errors.New("auto migrate table error: " + err.Error())
	}

	var hostOptions []libp2p.Option

	// Load or generate private key
	identityKey, err := loadOrGenerateKey(r.extOpts.libp2pIdentityKeyFile)
	if err != nil {
		return fmt.Errorf("failed to load private key[%s]: %v", r.options.PrivateKey, err)
	}

	hostOptions = append(hostOptions,
		/*		libp2p.Transport(webrtc.New),
				libp2p.Transport(quic.NewTransport),*/
		libp2p.Identity(identityKey),
		libp2p.EnableNATService(),
		libp2p.EnableHolePunching(),
		libp2p.EnableRelay(),
	)

	if r.extOpts.bootstrapEnable {
		// Define the listen address
		// todo, port user-defined
		addrs := r.extOpts.bootstrapListenAddrs
		if len(addrs) == 0 {
			addrs = append(addrs, "/ip4/0.0.0.0/tcp/4001")
		}

		for _, addr := range addrs {
			listenAddr, err := multiaddr.NewMultiaddr(addr)
			if err != nil {
				panic(err)
			}
			hostOptions = append(hostOptions, libp2p.ListenAddrs(listenAddr))
		}
	}

	// Initialize libp2p host
	h, err := libp2p.New(
		hostOptions...,
	)

	if err != nil {
		return fmt.Errorf("failed to create libp2p host: %v", err)
	}
	r.host = h
	notifee := &libp2pHostNotifee{
		nativeRegistry: r,
	}
	r.host.Network().Notify(notifee)

	// Create DHT instance in server mode
	r.dht, err = dht.New(ctx, h,
		dht.Mode(r.extOpts.runMode),
		// Isolate network namespace via /peers-touch
		dht.ProtocolPrefix(networkId),
		dht.Validator(
			record.NamespacedValidator{
				// actually, these validators are the defaults in libp2p[see github.com/libp2p/go-libp2p-kad-dht/internal/config/config.go#ApplyFallbacks]
				// but we need to set them here to learn how they work,
				// so we can customize them according to our needs in the future.
				"pk":                                  record.PublicKeyValidator{},
				"ipns":                                ipns.Validator{KeyBook: h.Peerstore()},
				registry.DefaultPeersNetworkNamespace: &NamespaceValidator{},
			},
		),
		dht.BootstrapPeersFunc(func() []peer.AddrInfo {
			// Start with configured bootstrap nodes and default peers
			bootstrapNodes := append(r.extOpts.bootstrapNodes, dht.DefaultBootstrapPeers...)
			// Add mDNS-discovered bootstrap nodes if mDNS is enabled
			if r.extOpts.mdnsEnable {
				r.mdnsBootstrapLock.RLock()
				mdnsBootstrapNodes := make([]multiaddr.Multiaddr, len(r.mdnsDiscoveredBootstrapNodes))
				copy(mdnsBootstrapNodes, r.mdnsDiscoveredBootstrapNodes)
				r.mdnsBootstrapLock.RUnlock()

				// Add mDNS-discovered bootstrap nodes to the list
				for _, mdnsAddr := range mdnsBootstrapNodes {
					// Check if already exists to avoid duplicates
					alreadyExists := false
					for _, existing := range bootstrapNodes {
						if existing.Equal(mdnsAddr) {
							alreadyExists = true
							break
						}
					}
					if !alreadyExists {
						bootstrapNodes = append(bootstrapNodes, mdnsAddr)
					}
				}
			}

			var peerBootstrapNodes []peer.AddrInfo
			for _, addr := range bootstrapNodes {
				pi, errIn := peer.AddrInfoFromP2pAddr(addr)
				if errIn != nil {
					logger.Errorf(ctx, "failed to parse bootstrap node address: %s", errIn)
					continue
				}
				peerBootstrapNodes = append(peerBootstrapNodes, *pi)
			}

			return peerBootstrapNodes
		}),
		dht.BucketSize(20),
		// dht.OnRequestHook(dhtRequestHooksWrap),
	)
	if err != nil {
		return fmt.Errorf("create libp2p host: %w", err)
	}

	// Bootstrap the DHT
	go r.bootstrap(ctx)

	// todo init relay nodes

	// Init MDNS with new internal mDNS service
	if r.extOpts.mdnsEnable {
		logger.Infof(ctx, "[Registry] mDNS node enabled for peer discovery")

		// Create new mDNS service with registry namespace
		r.mdnsService, err = mdns.NewMDNSService(ctx,
			mdns.WithNamespace("registry"),
			mdns.WithService("_peers-touch._tcp"),
		)
		if err != nil {
			return fmt.Errorf("failed to create mDNS service: %w", err)
		}

		// Set up discovery callback for bootstrap nodes
		r.mdnsService.Watch(func(discoveredPeer *types.Peer) {
			// Check if this is a bootstrap node
			if discoveredPeer.Nodes != nil && len(discoveredPeer.Nodes) > 0 {
				for _, node := range discoveredPeer.Nodes {
					if node.Type == "bootstrap" {
						// Convert peer to AddrInfo
						ctx := context.Background()
						peerID, err := peer.Decode(discoveredPeer.ID)
						if err != nil {
							logger.Errorf(ctx, "Failed to decode peer ID: %v", err)
							continue
						}
						pi := peer.AddrInfo{
							ID:    peerID,
							Addrs: []multiaddr.Multiaddr{},
						}

						// Parse addresses from peer metadata
						if addrs, ok := discoveredPeer.Metadata["addresses"].([]string); ok {
							for _, addrStr := range addrs {
								if addr, err := multiaddr.NewMultiaddr(addrStr); err == nil {
									pi.Addrs = append(pi.Addrs, addr)
								}
							}
						}

						// Add to bootstrap nodes list
						r.mdnsBootstrapLock.Lock()
						for _, addr := range pi.Addrs {
							// Create full multiaddr with peer ID
							fullAddr := addr.Encapsulate(multiaddr.StringCast("/p2p/" + pi.ID.String()))

							// Check if already exists to avoid duplicates
							alreadyExists := false
							for _, existing := range r.mdnsDiscoveredBootstrapNodes {
								if existing.Equal(fullAddr) {
									alreadyExists = true
									break
								}
							}

							if !alreadyExists {
								r.mdnsDiscoveredBootstrapNodes = append(r.mdnsDiscoveredBootstrapNodes, fullAddr)
								logger.Infof(context.Background(), "Added mDNS bootstrap node: %s", fullAddr.String())
							}
						}
						r.mdnsBootstrapLock.Unlock()

						// Connect to the discovered peer
						if err := r.host.Connect(ctx, pi); err != nil {
							logger.Errorf(ctx, "Failed to connect to discovered bootstrap peer: %v", err)
						}
					}
				}
			}
		})

		// Start the mDNS service
		if err := r.mdnsService.Start(); err != nil {
			return fmt.Errorf("failed to start mDNS service: %w", err)
		}

		// Cleanup mDNS when context is done
		go func() {
			<-ctx.Done()
			if r.mdnsService != nil {
				if err := r.mdnsService.Stop(); err != nil {
					logger.Errorf(context.Background(), "[Registry] Error stopping mDNS service: %v", err)
				}
			}
			logger.Infof(context.Background(), "[Registry] mDNS cleanup completed")
		}()
	}

	// Init TURN
	if r.options.TurnConfig.Enabled {
		addr := r.options.TurnConfig.ServerAddresses[0]
		conn, errIn := net.Dial("tcp", addr)
		if errIn != nil {
			return fmt.Errorf("connect to TURN server: %w", errIn)
		}

		cfg := &turn.ClientConfig{
			STUNServerAddr: addr,
			TURNServerAddr: addr,
			Conn:           turn.NewSTUNConn(conn),
			Username:       r.options.TurnConfig.ShortTerm.Username,
			Password:       r.options.TurnConfig.ShortTerm.Password,
			Realm:          "peers-touch",
			LoggerFactory:  NewLoggerFactory(),
		}

		// Create self-healing client manager
		r.turn = newTurnClient(ctx, cfg)
		// Start periodic health checks
		go func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()

			for {
				select {
				case <-ticker.C:
					r.refreshTurn(ctx)
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	// rememer to register it
	registration := &registry.Registration{
		ID:         r.host.ID().String(),
		Name:       r.host.ID().String(),
		Type:       "registry",
		Namespaces: []string{"native"},
		Addresses:  []string{},
		Metadata:   map[string]interface{}{},
	}

	// Get host addresses
	for _, addr := range r.host.Addrs() {
		registration.Addresses = append(registration.Addresses, addr.String())
	}

	// Set as default registry first, before registering self
	registry.SetDefaultRegistry(r)

	// Now register self
	if err := registry.Register(ctx, registration); err != nil {
		return fmt.Errorf("failed to register native registry: %w", err)
	}

	return nil
}

func (r *nativeRegistry) Options() registry.Options {
	return *r.options
}

// The Register function adds a new peer to the registry.
// Currently, we only store peers in the Distributed Hash Table (DHT) because the DHT
// only accepts IDs generated from public keys. We do not support individual IDs for peers.
// All peers use the same public key belonging to the host to generate their IDs.
// Consequently, we can only support registering one peer at present.
func (r *nativeRegistry) Register(ctx context.Context, registration *registry.Registration, opts ...registry.RegisterOption) error {
	regOpts := &registry.RegisterOptions{}
	for _, opt := range opts {
		opt(regOpts)
	}

	err := r.beforeRegister(ctx, registration, regOpts)
	if err != nil {
		return fmt.Errorf("register peer: %w", err)
	}

	doNow := make(chan struct{})
	go func() {
		ticker := time.NewTicker(r.options.Interval)
		defer ticker.Stop()

		re := func() {
			if errIn := r.register(ctx, registration, regOpts); errIn != nil {
				logger.Errorf(ctx, "native Registry failed to register peer: %s", errIn)
			} else {
				logger.Infof(ctx, "native Registry registered peer")
			}
		}

		for {
			select {
			case <-doNow:
				re()
			case <-ticker.C:
				re()
			case <-ctx.Done():
				return
			}
		}
	}()

	doNow <- struct{}{}
	return nil
}

// Deregister removes a peer from the registry,
// but DHT doesn't support delete operation, so we just remove it from the map
func (r *nativeRegistry) Deregister(ctx context.Context, id string, opts ...registry.DeregisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// For DHT-based registry, we use the ID as the key
	// Remove from local cache if it exists
	if peer, exists := r.peers[id]; exists {
		delete(r.peers, peer.Name)
	}

	// Remove from DHT network
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	key := fmt.Sprintf(peerKeyFormat, networkNamespace, id)
	// Set empty value with short TTL
	return r.dht.PutValue(ctx, key, []byte{})
}

func (r *nativeRegistry) Query(ctx context.Context, opts ...registry.QueryOption) ([]*registry.Registration, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	queryOpts := &registry.QueryOptions{}
	for _, o := range opts {
		o(queryOpts)
	}

	var results []*registry.Registration

	// Handle Me query (get current peer info)
	if queryOpts.Me {
		registration := &registry.Registration{
			ID:         r.host.ID().String(),
			Name:       r.host.ID().String(),
			Type:       "peer",
			Namespaces: []string{"local"},
			Addresses:  []string{},
			Metadata:   map[string]interface{}{},
		}

		var addrs []string
		for _, a := range r.host.Addrs() {
			addrs = append(addrs, a.String())
		}
		registration.Addresses = addrs
		registration.Metadata[MetaConstantKeyAddress] = strings.Join(addrs, ",")

		results = append(results, registration)
		return results, nil
	}

	// Handle ID-based query
	if queryOpts.ID != "" {
		targetID, err := peer.Decode(queryOpts.ID)
		if err != nil {
			return nil, fmt.Errorf("[Query] registry failed to decode peer ID: %w", err)
		}

		peerAddrs, err := r.dht.FindPeer(ctx, targetID)
		if err != nil {
			return nil, fmt.Errorf("[Query] registry failed to find peer: %w", err)
		}

		logger.Infof(ctx, "[Query] registry found peers: %+v", peerAddrs)

		key := fmt.Sprintf(peerKeyFormat, networkNamespace, queryOpts.ID)
		data, err := r.dht.GetValue(ctx, key)
		if err != nil {
			return results, nil // Return empty results if not found
		}

		peerReg, err := r.unmarshalPeer(data)
		if err != nil {
			return nil, err
		}

		// Convert Peer to Registration
		registration := &registry.Registration{
			ID:         peerReg.ID,
			Name:       peerReg.Name,
			Type:       "peer",
			Namespaces: []string{"dht"},
			Addresses:  []string{},
			Metadata:   peerReg.Metadata,
		}

		// Handle TURN addresses
		if time.Now().Sub(r.turnUpdateTime) > 8*time.Second {
			r.refreshTurn(ctx)
		}

		if len(r.turnRelayAddresses) > 0 {
			registration.Addresses = append(registration.Addresses, r.turnRelayAddresses...)
		}
		if len(r.turnStunAddresses) > 0 {
			registration.Addresses = append(registration.Addresses, r.turnStunAddresses...)
		}

		results = append(results, registration)
		return results, nil
	}

	// Handle name-based query (backward compatibility)
	if queryOpts.Name != "" {
		return r.listPeersToRegistrations(ctx, queryOpts)
	}

	// Default: list all peers
	return r.listPeersToRegistrations(ctx, queryOpts)
}

func (r *nativeRegistry) Watch(ctx context.Context, callback registry.WatchCallback, opts ...registry.WatchOption) error {
	// Implement DHT-based watch functionality using callback pattern
	return errors.New("[Watch] not implemented")
}

func (r *nativeRegistry) listPeersToRegistrations(ctx context.Context, queryOpts *registry.QueryOptions) ([]*registry.Registration, error) {
	peers, err := r.listPeers(ctx, queryOpts)
	if err != nil {
		return nil, err
	}

	var registrations []*registry.Registration
	for _, p := range peers {
		registration := &registry.Registration{
			ID:         p.ID,
			Name:       p.Name,
			Type:       "peer",
			Namespaces: []string{"dht"},
			Addresses:  []string{},
			Metadata:   p.Metadata,
		}
		registrations = append(registrations, registration)
	}

	return registrations, nil
}

func (r *nativeRegistry) listPeers(ctx context.Context, queryOpts *registry.QueryOptions) ([]*Peer, error) {

	// Create CID for provider lookup
	prefix := cid.Prefix{
		Version:  1,
		Codec:    cid.Raw,
		MhType:   multihash.SHA2_256,
		MhLength: -1,
	}
	serviceCID, err := prefix.Sum([]byte(networkNamespace + ":peers-node"))
	if err != nil {
		return nil, fmt.Errorf("[ListPeers] failed to create node CID: %w", err)
	}

	// Query DHT for all providers
	providerChan := r.dht.FindProvidersAsync(ctx, serviceCID, 0)

	var peers []*Peer
	seen := make(map[peer.ID]bool)

	// Process discovered providers
	for pi := range providerChan {
		// Skip self and bootstrap nodes
		if pi.ID == r.host.ID() || r.isBootstrapNode(pi.ID) {
			continue
		}

		// Get peer record from DHT
		key := fmt.Sprintf(peerKeyFormat, networkNamespace, pi.ID.String())
		data, err := r.dht.GetValue(ctx, key)
		if err != nil || seen[pi.ID] {
			continue
		}

		// Decode and add to results
		if peerReg, err := r.unmarshalPeer(data); err == nil {
			if peerReg.Metadata == nil {
				peerReg.Metadata = make(map[string]interface{})
			}
			peerReg.Metadata[MetaConstantKeyRegisterType] = MetaRegisterTypeDHT
			peers = append(peers, peerReg)
			seen[pi.ID] = true
		}
	}

	// Add direct connections
	for _, pid := range r.host.Network().Peers() {
		if !seen[pid] {
			addrs := r.host.Peerstore().Addrs(pid)
			addrStrings := make([]string, len(addrs))
			for i, addr := range addrs {
				addrStrings[i] = addr.String()
			}

			sort.Strings(addrStrings)
			peers = append(peers, &Peer{
				Name: pid.String(),
				Metadata: map[string]interface{}{
					MetaConstantKeyRegisterType: MetaRegisterTypeConnected,
					MetaConstantKeyAddress:      addrStrings,
				},
			})
		}
	}

	return peers, nil
}

func (r *nativeRegistry) ListPeers_old(ctx context.Context, queryOpts *registry.QueryOptions) ([]*Peer, error) {
	var connectedPeers []*Peer

	// Get the list of connected peer IDs
	peerIDs := r.host.Network().Peers()
	for _, peerID := range peerIDs {
		canBeAdded := r.dht.RoutingTable().UsefulNewPeer(peerID)
		if canBeAdded {
			added, err := r.dht.RoutingTable().TryAddPeer(peerID, true, true)
			if err != nil {
				logger.Errorf(ctx, "[ListPeers] failed to add peer %s to routing table: %s", peerID, err)
			}

			logger.Infof(ctx, "[ListPeers] peer %s canBeAdded to routing table result: %+v, added: %t. ", peerID, canBeAdded, added)

			addrInfo, err := r.dht.FindPeer(ctx, peerID)
			if err != nil {
				logger.Errorf(ctx, "[ListPeers] failed to find peer after Tray %s: %s", peerID, err)
			}

			logger.Infof(ctx, "[ListPeers] peer %s find in routing table result: %+v", peerID, addrInfo)
		}

		// Skip bootstrap nodes
		if r.isBootstrapNode(peerID) {
			continue
		}

		// Get addresses from peerstore
		addrs := r.host.Peerstore().Addrs(peerID)
		addrStrings := make([]string, len(addrs))
		for i, addr := range addrs {
			addrStrings[i] = addr.String()
		}

		// Create peer entry for connected peer
		peerConnected := &Peer{
			ID:   peerID.String(),
			Name: peerID.String(),
			Metadata: map[string]interface{}{
				MetaConstantKeyRegisterType: MetaRegisterTypeConnected,
				MetaConstantKeyAddress:      addrStrings,
			},
		}
		connectedPeers = append(connectedPeers, peerConnected)

		// Try to get additional peer data from DHT
		key := fmt.Sprintf(peerKeyFormat, networkNamespace, peerID.String())
		dhtValue, err := r.dht.GetValue(ctx, key)
		if err == nil && len(dhtValue) > 0 {
			dhtPeer, err := r.unmarshalPeer(dhtValue)
			if err == nil {
				if dhtPeer.Metadata == nil {
					dhtPeer.Metadata = map[string]interface{}{}
				}
				dhtPeer.Metadata[MetaConstantKeyRegisterType] = MetaRegisterTypeDHT
				connectedPeers = append(connectedPeers, dhtPeer)
			}
		}
	}

	return connectedPeers, nil
}

func (r *nativeRegistry) String() string {
	return "native-registry"
}

func (r *nativeRegistry) register(ctx context.Context, registration *registry.Registration, opts *registry.RegisterOptions) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if registration == nil {
		return errors.New("[register] registration cannot be nil")
	}

	// register to DHT
	{
		// Add provider announcement to DHT
		// Create CID for provider announcement
		prefix := cid.Prefix{
			Version:  1,
			Codec:    cid.Raw,
			MhType:   multihash.SHA2_256,
			MhLength: -1,
		}
		data := networkBootstrapNamespace + ":" + registration.ID
		serviceCID, err := prefix.Sum([]byte(data))
		if err != nil {
			return fmt.Errorf("[register] failed to create node CID: %w", err)
		}

		err = r.dht.Provide(ctx, serviceCID, true)
		if err != nil {
			logger.Warnf(ctx, "[register] Failed to announce as DHT provider: %v", err)
		}
	}
	// register to db
	{
		rd := &RegisterRecord{
			Version:       "0.0.1",
			PeerId:        registration.ID,
			PeerName:      registration.Name,
			Libp2pId:      r.host.ID().String(),
			EndStationMap: make(map[string]interface{}), // Convert to interface{} for V2 compatibility
		}

		err := r.setRegisterRecord(ctx, rd)
		if err != nil {
			logger.Warnf(ctx, "[register] Failed to register as DHT provider: %v", err)
		}
	}

	if r.dht.RoutingTable().Size() == 0 {
		logger.Infof(ctx, "[register] routing table still empty, no need to register")
		return nil
	}

	// Convert Registration to Peer for marshaling
	dataPk, err := r.marshalPeer(ctx, &Peer{
		ID:       registration.ID,
		Name:     registration.Name,
		Version:  "0.0.1", // Default version
		Metadata: registration.Metadata,
	})
	if err != nil {
		return fmt.Errorf("[register] failed to marshal peerReg: %w", err)
	}
	id := registration.ID
	key := fmt.Sprintf(peerKeyFormat, networkNamespace, id)

	err = r.dht.PutValue(ctx, key, dataPk)
	if err != nil {
		err = fmt.Errorf("[register] failed to put value to dht: %w", err)
		logger.Errorf(ctx, "%s", err)
		return err
	}
	return nil
}

func (r *nativeRegistry) beforeRegister(ctx context.Context, registration *registry.Registration, opts *registry.RegisterOptions) error {
	if registration.Metadata == nil {
		registration.Metadata = map[string]interface{}{}
	}

	if registration.ID == "" {
		return errors.New("[beforeRegister] registration ID cannot be nil")
	}

	if registration.Name == "" {
		return errors.New("[beforeRegister] registration Name cannot be nil")
	}

	registration.Metadata[MetaConstantKeyPeerID] = r.host.ID().String()

	// todo any other hooks?
	return nil
}

func (r *nativeRegistry) bootstrap(ctx context.Context) {
	ticker := time.NewTicker(r.extOpts.bootstrapRefreshInterval)
	defer ticker.Stop()

	logger.Infof(ctx, "bootstrap peer: %s", r.host.ID().String())

	// Initial bootstrap
	if err := r.dht.Bootstrap(ctx); err != nil {
		logger.Errorf(ctx, "[bootstrap] failed to bootstrap peers: %v", err)
	} else {
		logger.Infof(ctx, "[bootstrap] initial bootstrap successful")
	}

	// Note: Bootstrap peer connections are now handled automatically by BootstrapPeersFunc
	// which includes both configured and mDNS-discovered bootstrap nodes

	// Periodic bootstrap refresh
	for {
		select {
		case <-ticker.C:
			logger.Debugf(ctx, "[bootstrap] refreshing bootstrap for peer: %s", r.host.ID().String())
			if err := r.dht.Bootstrap(ctx); err != nil {
				logger.Errorf(ctx, "[bootstrap] failed to refresh bootstrap: %v", err)
			} else {
				logger.Debugf(ctx, "[bootstrap] bootstrap refresh successful")
			}
			// Also refresh routing table periodically
			go r.refreshRoutingTable(ctx)
		case <-ctx.Done():
			logger.Warnf(ctx, "[bootstrap] bootstrap stopped %+v", ctx.Err())
			return
		}
	}
}

func (r *nativeRegistry) refreshRoutingTable(ctx context.Context) {
	select {
	case err := <-r.dht.RefreshRoutingTable():
		if err != nil {
			logger.Debugf(ctx, "[refreshRoutingTable] Routing table refresh error: %v", err)
		}
	case <-time.After(30 * time.Second):
		logger.Warnf(ctx, "[refreshRoutingTable] Routing table refresh timed out")
	}
}

func (r *nativeRegistry) refreshTurn(ctx context.Context) {

	if r.turn == nil {
		logger.Infof(ctx, "[refreshTurn] turn peer not initialized")
		return
	}

	cl, errClient := r.turn.Get()
	if errClient != nil {
		logger.Errorf(ctx, "[refreshTurn] get native turn client failed: %v", errClient)
		return
	}

	// Allocate a relay socket on the TURN server. On success, it
	// will return a net.PacketConn which represents the remote
	// socket.
	relayConn, err := cl.Allocate()
	if err != nil && !strings.HasPrefix(err.Error(), "already allocated") {
		logger.Errorf(ctx, "[refreshTurn] Failed to allocate: %s", err)
		return
	} else if err == nil {
		// The relayConn's local address is actually the transport
		// address assigned on the TURN server.
		addr := relayConn.LocalAddr().String()
		logger.Infof(ctx, "relayed-address=%s", addr)
		r.turnRelayAddresses = append(r.turnRelayAddresses, addr)
		errAdd := r.addListenAddr(ctx, addr, "peers-relay")
		if errAdd != nil {
			logger.Errorf(ctx, "[refreshTurn] Failed to add listen relay-address: %v", errAdd)
		}
	}

	// Send BindingRequest to learn our external IP
	mappedAddr, err := cl.SendBindingRequest()
	if err != nil {
		logger.Errorf(ctx, "[refreshTurn] Failed to send binding request: %s", err)
		return
	} else {
		logger.Infof(ctx, "STUN traversal address=%s", mappedAddr.String())
		r.turnStunAddresses = append(r.turnStunAddresses, mappedAddr.String())
		/*errAdd := r.addListenAddr(ctx, mappedAddr.String(), "peers-stun")
		if errAdd != nil {
			logger.Errorf(ctx, "[refreshTurn] Failed to add listen stun-address: %v", errAdd)
		}*/
	}

	r.turnUpdateTime = time.Now()

	return
}

// updateBootstrapStatus function removed - no longer needed since bootstrap connections
// are handled automatically by BootstrapPeersFunc

func (r *nativeRegistry) signPayload(privateKey string, data []byte) ([]byte, error) {
	block, _ := pem.Decode([]byte(privateKey))
	if block == nil {
		return nil, errors.New("[signPayload] failed to parse PEM block")
	}

	priv, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("[signPayload] failed to parse private key: %w", err)
	}

	hashed := sha256.Sum256(data)
	return rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hashed[:])
}

// bootstrapSuccessful function removed - no longer needed since bootstrap connections
// are handled automatically by BootstrapPeersFunc

// addListenAddr adds a new listen address to the running libp2p host.
func (r *nativeRegistry) addListenAddr(ctx context.Context, addr string, protocol string) error {
	var ma string
	h, port, err := net.SplitHostPort(addr)
	if err == nil {
		ip := net.ParseIP(h)
		if ip.To4() != nil {
			ma = fmt.Sprintf("/ip4/%s/udp/%s/%s", h, port, protocol)
		} else {
			ma = fmt.Sprintf("/ip6/%s/udp/%s/%s", h, port, protocol)
		}
	}

	listenAddr, err := multiaddr.NewMultiaddr(ma)
	if err != nil {
		return fmt.Errorf("[addListenAddr] failed to create multiaddr from string '%s': %w", ma, err)
	}

	if err := r.host.Network().Listen(listenAddr); err != nil {
		return fmt.Errorf("[addListenAddr] failed to listen on new address[%s]: %w", listenAddr, err)
	}

	logger.Infof(ctx, "Host started listening on new address: %s", listenAddr)
	return nil
}

func (r *nativeRegistry) unmarshalPeer(data []byte) (peerReg *Peer, err error) {
	pk := &pb.PublicKey{}
	if err = proto.Unmarshal(data, pk); err != nil {
		return nil, fmt.Errorf("[unmarshalPeer] failed to unmarshal public key: %w", err)
	}

	peerReg = &Peer{}
	err = json.Unmarshal(pk.Data, peerReg)
	if err != nil {
		return nil, fmt.Errorf("[unmarshalPeer] failed to unmarshal peerReg: %w", err)
	}

	return peerReg, nil
}

func (r *nativeRegistry) marshalPeer(ctx context.Context, peerReg *Peer) ([]byte, error) {
	// Add security metadata
	peerReg.Version = "1.0"

	// Sign the payload
	dataToSign, err := json.Marshal(struct {
		Name      string
		Version   string
		Timestamp time.Time
	}{
		Name:      peerReg.Name,
		Version:   peerReg.Version,
		Timestamp: time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("[marshal] marshal data for signing: %w", err)
	}

	// Sign the payload using your node's private key
	signData, err := r.signPayload(r.options.PrivateKey, dataToSign) // Implement signing logic
	if err != nil {
		return nil, fmt.Errorf("[marshal] native Registry failed to sign payload: %w", err)
	}
	peerReg.Metadata = map[string]interface{}{
		"signature": signData,
		"timestamp": time.Now(),
	}

	// Serialize peerReg data
	data, err := json.Marshal(peerReg)
	if err != nil {
		return nil, fmt.Errorf("[marshal] marshal peerReg: %w", err)
	}

	// Store in DHT with 5min TTL
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	pk := &pb.PublicKey{
		Type: pb.KeyType_RSA.Enum(),
		Data: data,
	}

	dataPk, err := proto.Marshal(pk)
	if err != nil {
		return nil, fmt.Errorf("[marshal] marshal pk: %w", err)
	}

	return dataPk, nil
}

func (r *nativeRegistry) isBootstrapNode(id peer.ID) bool {
	// Check both custom and default bootstrap nodes
	allNodes := append(r.extOpts.bootstrapNodes, dht.DefaultBootstrapPeers...)
	for _, addr := range allNodes {
		pi, err := peer.AddrInfoFromP2pAddr(addr)
		if err != nil {
			continue // Skip invalid entries (shouldn't happen if nodes were properly configured)
		}
		if pi.ID == id {
			return true
		}
	}
	return false
}

// updateMDNSStats updates the mDNS discovery statistics
func (r *nativeRegistry) updateMDNSStats(totalDiscovered, bootstrapDiscovered, connectedBootstrap int, activePeers []string) {
	r.mdnsStatsLock.Lock()
	defer r.mdnsStatsLock.Unlock()

	r.mdnsStats.TotalDiscovered = totalDiscovered
	r.mdnsStats.BootstrapDiscovered = bootstrapDiscovered
	r.mdnsStats.ConnectedBootstrap = connectedBootstrap
	r.mdnsStats.LastDiscoveryTime = time.Now()
	r.mdnsStats.ActivePeers = activePeers
}

// getMDNSStats returns a copy of the current mDNS discovery statistics
func (r *nativeRegistry) getMDNSStats() mdnsDiscoveryStats {
	r.mdnsStatsLock.RLock()
	defer r.mdnsStatsLock.RUnlock()

	return *r.mdnsStats
}

// AddBootstrapNode adds a bootstrap node discovered via mDNS (implements mdns.Registry)
func (r *nativeRegistry) AddBootstrapNode(pi peer.AddrInfo) {
	r.mdnsBootstrapLock.Lock()
	defer r.mdnsBootstrapLock.Unlock()

	// Convert peer.AddrInfo to multiaddr format
	for _, addr := range pi.Addrs {
		// Create full multiaddr with peer ID
		fullAddr := addr.Encapsulate(multiaddr.StringCast("/p2p/" + pi.ID.String()))

		// Check if already exists to avoid duplicates
		alreadyExists := false
		for _, existing := range r.mdnsDiscoveredBootstrapNodes {
			if existing.Equal(fullAddr) {
				alreadyExists = true
				break
			}
		}

		if !alreadyExists {
			r.mdnsDiscoveredBootstrapNodes = append(r.mdnsDiscoveredBootstrapNodes, fullAddr)
			logger.Infof(context.Background(), "Added mDNS bootstrap node: %s", fullAddr.String())
		}
	}
}

// mdnsRegistryWrapper wraps nativeRegistry to implement mdns.Registry interface
type mdnsRegistryWrapper struct {
	*nativeRegistry
}

// Register implements mdns.Registry interface for peer registration
func (w *mdnsRegistryWrapper) Register(ctx context.Context, pi peer.AddrInfo) error {
	// Connect to the discovered peer
	return w.host.Connect(ctx, pi)
}

// GetLibp2pHost returns the libp2p host
// todo, remove this method. temporarily use.
func GetLibp2pHost() (h host.Host, dht *dht.IpfsDHT) {
	reg := regInstance.(*nativeRegistry)

	return reg.host, reg.dht
}
