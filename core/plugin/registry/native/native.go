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
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/golang/protobuf/proto"
	"github.com/ipfs/boxo/ipns"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	record "github.com/libp2p/go-libp2p-record"
	"github.com/libp2p/go-libp2p/core/crypto/pb"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
	"github.com/multiformats/go-multiaddr"
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

	peers map[string]*registry.Peer
	mu    sync.RWMutex

	host  host.Host
	dht   *dht.IpfsDHT
	mdnsS mdns.Service

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

	if r.options.PrivateKey == "" {
		return errors.New("private key for Registry is required")
	}

	// Load or generate private key
	identityKey, err := loadOrGenerateKey(r.extOpts.libp2pIdentityKeyFile)
	if err != nil {
		return fmt.Errorf("failed to load private key[%s]: %v", r.options.PrivateKey, err)
	}

	// Initialize libp2p host
	h, err := libp2p.New(
		libp2p.Identity(identityKey),
	)
	if err != nil {
		return err
	}
	r.host = h

	bootstrapNodes := append(r.extOpts.bootstrapNodes, dht.DefaultBootstrapPeers...)
	var peerBootstrapNodes []peer.AddrInfo
	for _, addr := range bootstrapNodes {
		pi, err := peer.AddrInfoFromP2pAddr(addr)
		if err != nil {
			return fmt.Errorf("failed to parse bootstrap node address: %s", err)
		}
		peerBootstrapNodes = append(peerBootstrapNodes, *pi)
	}

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
		dht.BootstrapPeers(peerBootstrapNodes...),
		dht.OnRequestHook(dhtRequestHooksWrap),
	)
	if err != nil {
		return fmt.Errorf("create libp2p host: %w", err)
	}

	// Bootstrap the DHT
	if err = r.dht.Bootstrap(ctx); err != nil {
		logger.Errorf(ctx, "failed to bootstrap peers: %v", err)
	}

	if r.extOpts.tryAddPeerManually {
		// Manually add self to routing table.
		// For now, I don't know why local nodes are not automatically added to the routing table.
		existed, err := r.dht.RoutingTable().TryAddPeer(r.host.ID(), true, true)
		if err != nil {
			logger.Errorf(ctx, "failed to add peer to routing table: %v", err)
		}
		logger.Infof(ctx, "added peer to routing table: %v", existed || existed == false && err == nil)
	}

	// todo init relay nodes

	// Init MDNS
	if r.extOpts.enableMDNS {
		r.mdnsS = mdns.NewMdnsService(r.host, "peers-touch.mdns", &mdnsNotifee{})
		err = r.mdnsS.Start()
		if err != nil {
			return fmt.Errorf("start mdns service: %w", err)
		}
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

	if regOpts.Interval == 0 {
		regOpts.Interval = 5 * time.Second
	}

	go func() {
		ticker := time.NewTicker(regOpts.Interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if err := r.register(ctx, peerReg, regOpts); err != nil {
					logger.Errorf(ctx, "native Registry failed to register peer: %s", err)
				} else {
					logger.Infof(ctx, "native Registry registered peer")
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	return nil
}

// Deregister removes a peer from the registry
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

func (r *nativeRegistry) GetPeer(ctx context.Context, name string, opts ...registry.GetOption) ([]*registry.Peer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	key := fmt.Sprintf(peerKeyFormat, networkNamespace, name)
	data, err := r.dht.GetValue(ctx, key)
	if err != nil {
		return nil, err
	}

	var p registry.Peer
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return []*registry.Peer{&p}, nil
}

func (r *nativeRegistry) Watch(ctx context.Context, opts ...registry.WatchOption) (registry.Watcher, error) {
	// Implement DHT-based watch functionality
	return nil, errors.New("not implemented")
}

func (r *nativeRegistry) String() string {
	return "libp2p-registry"
}

func (r *nativeRegistry) register(ctx context.Context, peerReg *registry.Peer, opts *registry.RegisterOptions) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peerReg == nil {
		return errors.New("peerReg cannot be nil")
	}

	/*	_, ok := r.bootstrapSuccessful()
		if !ok {
			return errors.New("bootstrap not ready")
		}*/

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
		return fmt.Errorf("native Registry failed to sign payload: %w", err)
	}
	peerReg.Signature = signData

	// Serialize peerReg data
	data, err := json.Marshal(peerReg)
	if err != nil {
		return fmt.Errorf("marshal peerReg: %w", err)
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
		return fmt.Errorf("marshal pk: %w", err)
	}

	id := r.host.ID().String()
	err = r.dht.PutValue(ctx, networkNamespace+"/"+id, dataPk)
	if err != nil {
		err = fmt.Errorf("failed to put value to dht: %w", err)
		logger.Errorf(ctx, "%s", err)
		return err
	}

	return nil
}

func (r *nativeRegistry) bootstrap(ctx context.Context, bootstraps []multiaddr.Multiaddr) {
	ticker := time.NewTicker(r.extOpts.bootstrapRefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			wg := sync.WaitGroup{}
			// Connect to public bootstrap nodes
			for _, addr := range bootstraps {
				wg.Add(1)
				go func(addr multiaddr.Multiaddr) (ok bool) {
					defer wg.Done()

					ctxTimout, cancel := context.WithTimeout(ctx, r.options.ConnectTimeout)
					defer cancel()

					defer func() {
						r.updateBootstrapStatus(ctx, addr.String(), ok)
					}()

					if r.bootstrapNodesStatus[addr.String()] != nil && r.bootstrapNodesStatus[addr.String()].failedTimes > 5 {
						logger.Warnf(ctx, "bootstrap node %s is offline. skipped", addr.String())
						ok = false
						return
					}

					pi, _ := peer.AddrInfoFromP2pAddr(addr)
					if r.host.Network().Connectedness(pi.ID) == network.Connected {
						logger.Infof(ctx, "bootstrap node %s is online", addr.String())
						ok = true
						return
					}

					if err := r.host.Connect(ctxTimout, *pi); err != nil {
						logger.Errorf(ctx, "failed to connect to public bootstrap node %s: %v", addr, err)
						ok = false
						return
					}

					ok = true

					logger.Infof(ctx, "successfully connected to public bootstrap node %s", addr)
					return ok
				}(addr)
			}
			wg.Wait()

			if err := r.dht.Bootstrap(ctx); err != nil {
				logger.Errorf(ctx, "failed to bootstrap peers: %v", err)
			}

			if r.extOpts.tryAddPeerManually {
				// Manually add self to routing table.
				// For now, I don't know why local nodes are not automatically added to the routing table.
				existed, err := r.dht.RoutingTable().TryAddPeer(r.host.ID(), true, true)
				if err != nil {
					logger.Errorf(ctx, "failed to add peer to routing table: %v", err)
				}
				logger.Infof(ctx, "added peer to routing table: %v", existed || existed == false && err == nil)
			}
		case <-ctx.Done():
			logger.Warnf(ctx, "bootstrap stopped %+v", ctx.Err())
			return
		}
	}
}

// Add new helper method
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

// Add this new method
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

// GetLibp2pHost returns the libp2p host
// todo, remove this method. temporarily use.
func GetLibp2pHost() (h host.Host, dht *dht.IpfsDHT) {
	reg := regInstance.(*nativeRegistry)

	return reg.host, reg.dht
}
