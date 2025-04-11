package native

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

var (
	// keep be a singleton
	regInstance registry.Registry
	regOnce     sync.RWMutex
)

// native registry is based on libp2p kad-dht
// it works as a peer discovery service which serves entrance for peers to find each other
type nativeRegistry struct {
	options *registry.Options
	// for convenience
	extOpts *options

	peers map[string]*registry.Peer
	mu    sync.RWMutex

	host host.Host
	dht  *dht.IpfsDHT
}

func NewRegistry(opts ...option.Option) registry.Registry {
	regOnce.Lock()
	defer regOnce.Unlock()

	if regInstance != nil {
		return regInstance
	}

	regInstance = &nativeRegistry{
		peers:   make(map[string]*registry.Peer),
		options: registry.GetPluginRegions(opts...),
	}

	return regInstance
}

func (r *nativeRegistry) Init(ctx context.Context, opts ...option.Option) error {
	r.options.Apply(opts...)
	r.extOpts = r.options.ExtOptions.(*options)

	// Initialize libp2p host
	h, err := libp2p.New()
	if err != nil {
		return err
	}
	r.host = h

	// Create DHT instance in server mode
	r.dht, err = dht.New(ctx, h, dht.Mode(r.extOpts.runMode))
	if err != nil {
		return err
	}

	// merge bootstrap nodes
	bootstrapNodes := append(r.extOpts.bootstrapNodes, dht.DefaultBootstrapPeers...)
	// Bootstrap the DHT
	err = r.bootstrap(ctx, bootstrapNodes)
	if err != nil {
		return err
	}

	// todo init relay nodes

	return nil
}

func (r *nativeRegistry) Options() registry.Options {
	return *r.options
}

func (r *nativeRegistry) Register(ctx context.Context, peer *registry.Peer, opts ...registry.RegisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peer == nil {
		return errors.New("peer cannot be nil")
	}

	// Serialize peer data
	data, err := json.Marshal(peer)
	if err != nil {
		return err
	}

	// Store in DHT with 24h TTL
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	key := "/peers/" + peer.Name
	return r.dht.PutValue(ctx, key, data)
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

	key := "/peers/" + peer.Name
	// Set empty value with short TTL
	return r.dht.PutValue(ctx, key, []byte{})
}

func (r *nativeRegistry) GetPeer(ctx context.Context, name string, opts ...registry.GetOption) ([]*registry.Peer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	key := "/peers/" + name
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

func (r *nativeRegistry) bootstrap(ctx context.Context, bootstraps []multiaddr.Multiaddr) error {
	wg := sync.WaitGroup{}

	errMap := map[string]error{}
	// Connect to public bootstrap nodes
	for _, addr := range bootstraps {
		wg.Add(1)
		go func(addr multiaddr.Multiaddr) {
			ctxTimout, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()

			pi, _ := peer.AddrInfoFromP2pAddr(addr)
			if err := r.host.Connect(ctxTimout, *pi); err != nil {
				logger.Errorf(ctx, "failed to connect to public bootstrap node %s: %v", addr, err)
				errMap[addr.String()] = err
				return // ignore error
			}
		}(addr)
	}
	wg.Wait()

	if len(errMap) > 0 {
		return fmt.Errorf("bootstrap met err: %v", errMap)
	}

	return r.dht.Bootstrap(ctx)
}
