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

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/golang/protobuf/proto"
	"github.com/ipfs/boxo/ipns"
	"github.com/ipfs/go-cid"
	"github.com/ipfs/go-log/v2"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	record "github.com/libp2p/go-libp2p-record"
	"github.com/libp2p/go-libp2p/core/crypto/pb"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
	"github.com/multiformats/go-multiaddr"
	"github.com/multiformats/go-multihash"
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

type bootstrapState struct {
	Connected   bool
	UpdatedAt   time.Time
	failedTimes int
	Logs        []string
}

// native registry is based on telibp2p kad-dht
// it works as a peer discovery service which serves entrance for peers to find each other
type nativeRegistry struct {
	options *registry.Options
	// for convenience
	extOpts *options

	store store.Store
	peers map[string]*registry.Peer
	mu    sync.RWMutex

	host  host.Host
	dht   *dht.IpfsDHT
	mdnsS mdns.Service

	turn               *turnClient
	turnUpdateLock     sync.Mutex
	turnUpdateTime     time.Time
	turnStunAddresses  []string
	turnRelayAddresses []string

	// bootstrap nodes status
	bootstrapStateLock   sync.RWMutex
	bootstrapNodesStatus map[string]*bootstrapState
}

func NewRegistry(opts ...option.Option) registry.Registry {
	regOnce.Lock()
	defer regOnce.Unlock()

	if regInstance != nil {
		return regInstance
	}

	regInstance = &nativeRegistry{
		peers:                make(map[string]*registry.Peer),
		options:              registry.GetPluginRegions(opts...),
		bootstrapNodesStatus: make(map[string]*bootstrapState),
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
		libp2p.Identity(identityKey))

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
			bootstrapNodes := append(r.extOpts.bootstrapNodes, dht.DefaultBootstrapPeers...)

			if r.extOpts.bootstrapToSelf {
				// todo bootstrap self to current node if this node is a bootstrap one.
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
		dht.OnRequestHook(dhtRequestHooksWrap),
	)
	if err != nil {
		return fmt.Errorf("create libp2p host: %w", err)
	}

	// Bootstrap the DHT
	go r.bootstrap(ctx)

	// todo init relay nodes

	// Init MDNS
	if r.extOpts.mdnsEnable {
		r.mdnsS = mdns.NewMdnsService(r.host, "peers-touch.mdns", &mdnsNotifee{})
		err = r.mdnsS.Start()
		if err != nil {
			return fmt.Errorf("start mdns service: %w", err)
		}
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
func (r *nativeRegistry) Register(ctx context.Context, peerReg *registry.Peer, opts ...registry.RegisterOption) error {
	regOpts := &registry.RegisterOptions{}
	for _, opt := range opts {
		opt(regOpts)
	}

	err := r.beforeRegister(ctx, peerReg, regOpts)
	if err != nil {
		return fmt.Errorf("register peer: %w", err)
	}

	doNow := make(chan struct{})
	go func() {
		ticker := time.NewTicker(r.options.Interval)
		defer ticker.Stop()

		re := func() {
			if errIn := r.register(ctx, peerReg, regOpts); errIn != nil {
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
func (r *nativeRegistry) Deregister(ctx context.Context, peer *registry.Peer, opts ...registry.DeregisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peer == nil {
		return errors.New("peer cannot be nil")
	}

	// Remove from local cache
	delete(r.peers, peer.Name)

	// Remove from DHT network
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	key := fmt.Sprintf(peerKeyFormat, networkNamespace, peer.Name)
	// Set empty value with short TTL
	return r.dht.PutValue(ctx, key, []byte{})
}

func (r *nativeRegistry) GetPeer(ctx context.Context, name string, opts ...registry.GetOption) (*registry.Peer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	getOpts := &registry.GetOptions{}
	for _, o := range opts {
		o(getOpts)
	}

	targetID, err := peer.Decode(name)
	if err != nil {
		return nil, fmt.Errorf("[GetPeer] registry failed to decode peer ID: %w", err)
	}

	peerAddrs, err := r.dht.FindPeer(ctx, targetID)
	if err != nil {
		return nil, fmt.Errorf("[GetPeer] registry failed to find peer: %w", err)
	}

	logger.Infof(ctx, "[GetPeer] registry found peers: %+v", peerAddrs)

	key := fmt.Sprintf(peerKeyFormat, networkNamespace, name)
	data, err := r.dht.GetValue(ctx, key)
	if err != nil {
		return nil, err
	}

	var p *registry.Peer
	if p, err = r.unmarshalPeer(data); err != nil {
		return nil, err
	}

	// append accessible networks
	// todo configure
	if time.Now().Sub(r.turnUpdateTime) > 8*time.Second {
		r.refreshTurn(ctx)
	}

	p.EndStation = map[string]*registry.EndStation{}
	if len(r.turnRelayAddresses) > 0 {
		p.EndStation = map[string]*registry.EndStation{
			registry.StationTypeTurnRelay: {
				Name:       registry.StationTypeTurnRelay,
				Typ:        registry.StationTypeTurnRelay,
				NetAddress: r.turnRelayAddresses[0],
			},
		}
	}
	if len(r.turnStunAddresses) > 0 {
		p.EndStation = map[string]*registry.EndStation{
			registry.StationTypeStun: {
				Name:       registry.StationTypeStun,
				Typ:        registry.StationTypeStun,
				NetAddress: r.turnStunAddresses[0],
			},
		}
	}

	return p, nil
}

func (r *nativeRegistry) Watch(ctx context.Context, opts ...registry.WatchOption) (registry.Watcher, error) {
	// Implement DHT-based watch functionality
	return nil, errors.New("not implemented")
}

func (r *nativeRegistry) ListPeers(ctx context.Context, opts ...registry.GetOption) ([]*registry.Peer, error) {
	// Create CID for provider lookup
	prefix := cid.Prefix{
		Version:  1,
		Codec:    cid.Raw,
		MhType:   multihash.SHA2_256,
		MhLength: -1,
	}
	serviceCID, err := prefix.Sum([]byte(networkNamespace + ":peers-service"))
	if err != nil {
		return nil, fmt.Errorf("failed to create service CID: %w", err)
	}

	// Query DHT for all providers
	providerChan := r.dht.FindProvidersAsync(ctx, serviceCID, 0)

	var peers []*registry.Peer
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
			peers = append(peers, &registry.Peer{
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

func (r *nativeRegistry) ListPeers_old(ctx context.Context, opts ...registry.GetOption) ([]*registry.Peer, error) {
	var connectedPeers []*registry.Peer

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

		// Here you need to get more information about the peer to create a registry.Peer struct.
		// For simplicity, we assume you can get the peer's name from the peer ID (this may need adjustment in a real - world scenario).
		peerName := peerID.String()
		var addrs []string
		addrInfo, err := r.dht.FindPeer(ctx, peerID)
		if err != nil {
			logger.Errorf(ctx, "[ListPeers] failed to find peer %s: %s", peerID, err)
		} else {
			addrs = make([]string, len(addrInfo.Addrs))
			for i, addr := range addrInfo.Addrs {
				addrs[i] = addr.String()
			}

			// Create a new registry.Peer struct
			peerConnected := &registry.Peer{
				Name: peerName,
				// You may need to fill in other fields according to your actual requirements.
				// For example, you can get the peer's addresses from the peerstore.
				Metadata: map[string]interface{}{
					MetaConstantKeyRegisterType: MetaRegisterTypeConnected,
					MetaConstantKeyAddress:      addrs,
				},
			}
			connectedPeers = append(connectedPeers, peerConnected)
		}

		dhtValue, err := r.dht.GetValue(ctx, networkNamespace+"/"+peerName)
		if err != nil {
			logger.Errorf(ctx, "[ListPeers] failed to get dht value: %s", err)
			continue
		}

		if dhtValue != nil {
			var dhtPeer *registry.Peer
			if dhtPeer, err = r.unmarshalPeer(dhtValue); err != nil {
				logger.Errorf(ctx, "[ListPeers] failed to unmarshal dht value: %s", err)
				continue
			}

			var dhtPk pb.PublicKey
			err = proto.Unmarshal(dhtValue, &dhtPk)
			if err != nil {
				logger.Errorf(ctx, "[ListPeers] failed to unmarshal dht pk value: %s", err)
				continue
			}

			if dhtPeer.Metadata == nil {
				dhtPeer.Metadata = map[string]interface{}{}
			}
			dhtPeer.Metadata[MetaConstantKeyRegisterType] = MetaRegisterTypeDHT

			connectedPeers = append(connectedPeers, dhtPeer)
		}
	}

	return connectedPeers, nil
}

func (r *nativeRegistry) String() string {
	return "native-registry"
}

func (r *nativeRegistry) register(ctx context.Context, peerReg *registry.Peer, opts *registry.RegisterOptions) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peerReg == nil {
		return errors.New("[register] peerReg cannot be nil")
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
		data := networkBootstrapNamespace + ":" + peerReg.ID
		serviceCID, err := prefix.Sum([]byte(data))
		if err != nil {
			return fmt.Errorf("failed to create service CID: %w", err)
		}

		err = r.dht.Provide(ctx, serviceCID, true)
		if err != nil {
			logger.Warnf(ctx, "Failed to announce as DHT provider: %v", err)
		}
	}
	// register to db
	{
		rd := &RegisterRecord{
			Version:       "0.0.1",
			PeerId:        peerReg.ID,
			PeerName:      peerReg.Name,
			Libp2pId:      r.host.ID().String(),
			EndStationMap: peerReg.EndStation,
		}

		err := r.setRegisterRecord(ctx, rd)
		if err != nil {
			logger.Warnf(ctx, "Failed to register as DHT provider: %v", err)
		}
	}

	if r.dht.RoutingTable().Size() == 0 {
		logger.Infof(ctx, "[register] routing table still empty, no need to register")
		return nil
	}

	dataPk, err := r.marshalPeer(ctx, peerReg)
	if err != nil {
		return fmt.Errorf("[register] failed to marshal peerReg: %w", err)
	}
	id := r.host.ID().String()
	key := fmt.Sprintf(peerKeyFormat, networkNamespace, id)

	err = r.dht.PutValue(ctx, key, dataPk)
	if err != nil {
		err = fmt.Errorf("failed to put value to dht: %w", err)
		logger.Errorf(ctx, "%s", err)
		return err
	}
	return nil
}

func (r *nativeRegistry) beforeRegister(ctx context.Context, peerReg *registry.Peer, opts *registry.RegisterOptions) error {
	if peerReg.Metadata == nil {
		peerReg.Metadata = map[string]interface{}{}
	}

	if peerReg.ID == "" {
		return errors.New("peer ID cannot be nil")
	}

	if peerReg.Version == "" {
		return errors.New("peer Version cannot be nil")
	}

	if peerReg.Name == "" {
		return errors.New("peer Name cannot be nil")
	}

	peerReg.Metadata[MetaConstantKeyPeerID] = r.host.ID().String()

	// todo any other hooks?
	return nil
}

func (r *nativeRegistry) bootstrap(ctx context.Context) {
	ticker := time.NewTicker(r.extOpts.bootstrapRefreshInterval)
	defer ticker.Stop()

	logger.Infof(ctx, "bootstrap peer: %s", r.host.ID().String())

	if err := r.dht.Bootstrap(ctx); err != nil {
		logger.Errorf(ctx, "failed to bootstrap peers: %v", err)
	}

	if true {
		return
	}

	for {
		select {
		case <-ticker.C:
			logger.Infof(ctx, "bootstrap peer: %s", r.host.ID().String())
			if err := r.dht.Bootstrap(ctx); err != nil {
				logger.Errorf(ctx, "failed to bootstrap peers: %v", err)
			}
		case <-ctx.Done():
			logger.Warnf(ctx, "bootstrap stopped %+v", ctx.Err())
			return
		}
	}
}

func (r *nativeRegistry) refreshRoutingTable(ctx context.Context) {
	select {
	case err := <-r.dht.RefreshRoutingTable():
		if err != nil {
			logger.Debugf(ctx, "Routing table refresh error: %v", err)
		}
	case <-time.After(30 * time.Second):
		logger.Warnf(ctx, "Routing table refresh timed out")
	}
}

func (r *nativeRegistry) refreshTurn(ctx context.Context) {
	r.bootstrapStateLock.RLock()
	defer r.bootstrapStateLock.RUnlock()

	cl, errClient := r.turn.Get()
	if errClient != nil {
		logger.Errorf(ctx, "get native turn client failed: %v", errClient)
		return
	}

	// Allocate a relay socket on the TURN server. On success, it
	// will return a net.PacketConn which represents the remote
	// socket.
	relayConn, err := cl.Allocate()
	if err != nil && !strings.HasPrefix(err.Error(), "already allocated") {
		logger.Errorf(ctx, "Failed to allocate: %s", err)
		return
	} else if err == nil {
		// The relayConn's local address is actually the transport
		// address assigned on the TURN server.
		logger.Infof(ctx, "relayed-address=%s", relayConn.LocalAddr().String())
		r.turnRelayAddresses = append(r.turnRelayAddresses, relayConn.LocalAddr().String())
	}

	// Send BindingRequest to learn our external IP
	mappedAddr, err := cl.SendBindingRequest()
	if err != nil {
		logger.Errorf(ctx, "Failed to send binding request: %s", err)
		return
	} else {
		logger.Infof(ctx, "STUN traversal address=%s", mappedAddr.String())
		r.turnStunAddresses = append(r.turnStunAddresses, mappedAddr.String())
	}

	r.turnUpdateTime = time.Now()

	return
}

func (r *nativeRegistry) updateBootstrapStatus(ctx context.Context, addr string, successful bool) {
	r.bootstrapStateLock.Lock()
	defer r.bootstrapStateLock.Unlock()

	t := time.Now()
	log := fmt.Sprintf("%+v:%t", t, successful)
	if status, ok := r.bootstrapNodesStatus[addr]; !ok {
		r.bootstrapNodesStatus[addr] = &bootstrapState{
			Connected: successful,
			UpdatedAt: t,
			Logs:      []string{log},
		}
	} else {
		status.Connected = successful
		status.UpdatedAt = t
		if len(status.Logs) == 10 {
			// remove the first element, we only keep the last 10 logs
			status.Logs = status.Logs[1:]
		}

		status.Logs = append(status.Logs, log)
	}

	if !successful {
		r.bootstrapNodesStatus[addr].failedTimes++
	} else {
		r.bootstrapNodesStatus[addr].failedTimes = 0
	}

	return
}

func (r *nativeRegistry) signPayload(privateKey string, data []byte) ([]byte, error) {
	block, _ := pem.Decode([]byte(privateKey))
	if block == nil {
		return nil, errors.New("failed to parse PEM block")
	}

	priv, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	hashed := sha256.Sum256(data)
	return rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hashed[:])
}

func (r *nativeRegistry) bootstrapSuccessful() (workingBootNodes []string, ok bool) {
	r.bootstrapStateLock.RLock()
	defer r.bootstrapStateLock.RUnlock()

	for addr, status := range r.bootstrapNodesStatus {
		// todo, only checking Connected is not healthy.
		if status.Connected {
			workingBootNodes = append(workingBootNodes, addr)
		}
	}

	return workingBootNodes, len(workingBootNodes) > 0
}

func (r *nativeRegistry) unmarshalPeer(data []byte) (peerReg *registry.Peer, err error) {
	pk := &pb.PublicKey{}
	if err = proto.Unmarshal(data, pk); err != nil {
		return nil, fmt.Errorf("[unmarshalPeer] failed to unmarshal public key: %w", err)
	}

	peerReg = &registry.Peer{}
	err = json.Unmarshal(pk.Data, peerReg)
	if err != nil {
		return nil, fmt.Errorf("[unmarshalPeer] failed to unmarshal peerReg: %w", err)
	}

	return peerReg, nil
}

func (r *nativeRegistry) marshalPeer(ctx context.Context, peerReg *registry.Peer) ([]byte, error) {
	// Add security metadata
	peerReg.Version = "1.0"
	peerReg.Timestamp = time.Now()

	// Sign the payload
	dataToSign, err := json.Marshal(struct {
		Name      string
		Version   string
		Timestamp time.Time
	}{
		Name:      peerReg.Name,
		Version:   peerReg.Version,
		Timestamp: peerReg.Timestamp,
	})

	// Sign the payload using your service's private key
	signData, err := r.signPayload(r.options.PrivateKey, dataToSign) // Implement signing logic
	if err != nil {
		return nil, fmt.Errorf("[marshal] native Registry failed to sign payload: %w", err)
	}
	peerReg.Signature = signData

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

// GetLibp2pHost returns the libp2p host
// todo, remove this method. temporarily use.
func GetLibp2pHost() (h host.Host, dht *dht.IpfsDHT) {
	reg := regInstance.(*nativeRegistry)

	return reg.host, reg.dht
}
