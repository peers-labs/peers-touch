package dht

import (
	"errors"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

type DHTRegistry struct {
	options registry.Options
	peers   map[string]*registry.Peer
	mu      sync.RWMutex
}

func NewDHTRegistry(opts ...registry.Option) (*DHTRegistry, error) {
	r := &DHTRegistry{
		peers: make(map[string]*registry.Peer),
	}

	for _, opt := range opts {
		opt(&r.options)
	}

	return r, nil
}

func (r *DHTRegistry) Init(opts ...registry.Option) error {
	for _, opt := range opts {
		opt(&r.options)
	}
	return nil
}

func (r *DHTRegistry) Options() registry.Options {
	return r.options
}

func (r *DHTRegistry) Register(peer *registry.Peer, opts ...registry.RegisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peer == nil {
		return errors.New("peer cannot be nil")
	}

	// Store peer in DHT
	r.peers[peer.Name] = peer

	// Replicate to closest nodes in DHT
	// (Implementation of DHT replication would go here)

	return nil
}

func (r *DHTRegistry) Deregister(peer *registry.Peer, opts ...registry.DeregisterOption) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if peer == nil {
		return errors.New("peer cannot be nil")
	}

	delete(r.peers, peer.Name)

	// Remove from DHT network
	// (Implementation of DHT removal would go here)

	return nil
}

func (r *DHTRegistry) GetPeer(name string, opts ...registry.GetOption) ([]*registry.Peer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if peer, exists := r.peers[name]; exists {
		return []*registry.Peer{peer}, nil
	}

	// If not found locally, query DHT network
	// (Implementation of DHT lookup would go here)

	return nil, errors.New("peer not found")
}

func (r *DHTRegistry) Watch(opts ...registry.WatchOption) (registry.Watcher, error) {
	// Implement DHT-based watch functionality
	return nil, errors.New("not implemented")
}

func (r *DHTRegistry) String() string {
	return "dht-registry"
}
