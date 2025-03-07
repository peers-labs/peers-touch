package dht

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
)

type Registry struct {
	options registry.Options
	peers   map[string]*registry.Peer
	mu      sync.RWMutex

	host host.Host
	dht  *dht.IpfsDHT
}

func NewRegistry(opts ...registry.Option) (*Registry, error) {
	r := &Registry{
		peers: make(map[string]*registry.Peer),
	}

	for _, opt := range opts {
		opt(&r.options)
	}

	return r, nil

}

func (r *Registry) Init(ctx context.Context, opts ...registry.Option) error {
	for _, opt := range opts {
		opt(&r.options)
	}

	if r.host == nil {
		r.options
	}

	// Initialize libp2p host
	h, err := libp2p.New()
	if err != nil {
		return err
	}
	r.host = h

	// Create DHT instance in server mode
	r.dht, err = dht.New(context.Background(), h, dht.Mode(dht.ModeServer))
	if err != nil {
		return err
	}

	// Bootstrap the DHT
	err = r.bootstrap()
	if err != nil {
		return err
	}

	return nil
}

func (r *Registry) Options() registry.Options {
	return r.options
}

func (r *Registry) Register(ctx context.Context, peer *registry.Peer, opts ...registry.RegisterOption) error {
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
func (r *Registry) Deregister(ctx context.Context, peer *registry.Peer, opts ...registry.DeregisterOption) error {
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

func (r *Registry) GetPeer(ctx context.Context, name string, opts ...registry.GetOption) ([]*registry.Peer, error) {
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

func (r *Registry) Watch(opts ...registry.WatchOption) (registry.Watcher, error) {
	// Implement DHT-based watch functionality
	return nil, errors.New("not implemented")
}

func (r *Registry) String() string {
	return "dht-registry"
}

func (r *Registry) bootstrap() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Connect to public bootstrap nodes
	for _, addr := range dht.DefaultBootstrapPeers {
		pi, _ := peer.AddrInfoFromP2pAddr(addr)
		if err := r.host.Connect(ctx, *pi); err != nil {
			continue
		}
	}
	return r.dht.Bootstrap(ctx)
}
