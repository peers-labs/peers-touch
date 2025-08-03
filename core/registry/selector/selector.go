package selector

import (
	"context"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

// Selector is an interface for selecting peers from the registry
type Selector interface {
	// Select returns a peer from the registry
	Select(opts ...registry.GetOption) (*registry.Peer, error)
	// Mark sets the status of a peer
	Mark(peerName string, peer *registry.Peer, err error)
	// Reset resets the selector state
	Reset(peer string)
	// Close closes the selector
	Close() error
}

// Strategy is a selection strategy
type Strategy func([]*registry.Peer) *registry.Peer

// Filter is a peer filter
type Filter func([]*registry.Peer) []*registry.Peer

// Options are selector options
type Options struct {
	Strategy Strategy
	Filters  []Filter
	Registry registry.Registry
}

// SelectOption configures the selector
type SelectOption func(*Options)

// WithStrategy sets the selection strategy
func WithStrategy(fn Strategy) SelectOption {
	return func(o *Options) {
		o.Strategy = fn
	}
}

// WithFilter adds a peer filter
func WithFilter(fn Filter) SelectOption {
	return func(o *Options) {
		o.Filters = append(o.Filters, fn)
	}
}

// WithRegistry sets the registry
func WithRegistry(r registry.Registry) SelectOption {
	return func(o *Options) {
		o.Registry = r
	}
}

// DefaultSelector is the default selector implementation
type DefaultSelector struct {
	registry registry.Registry
	cache    map[string]*registry.Peer
	status   map[string]map[string]int
	mutex    sync.RWMutex
	opts     Options
}

// NewSelector creates a new selector
func NewSelector(opts ...SelectOption) Selector {
	options := Options{
		Strategy: Random,
	}

	for _, o := range opts {
		o(&options)
	}

	return &DefaultSelector{
		registry: options.Registry,
		cache:    make(map[string]*registry.Peer),
		status:   make(map[string]map[string]int),
		opts:     options,
	}
}

// Select returns a peer peer
func (s *DefaultSelector) Select(opts ...registry.GetOption) (*registry.Peer, error) {
	// Parse GetOptions to extract peer name
	getOpts := &registry.GetOptions{}
	for _, opt := range opts {
		opt(getOpts)
	}

	// Use the Name field as the peer identifier
	peerName := getOpts.Name
	if peerName == "" {
		return nil, registry.ErrNotFound
	}

	s.mutex.RLock()
	cached, ok := s.cache[peerName]
	s.mutex.RUnlock()

	if !ok {
		// Get from registry using the provided options
		peer, err := s.registry.GetPeer(context.Background(), opts...)
		if err != nil {
			return nil, err
		}

		if peer == nil {
			return nil, registry.ErrNotFound
		}

		s.mutex.Lock()
		s.cache[peerName] = peer
		s.mutex.Unlock()

		cached = peer
	}

	// For single peer selection, we create a slice with just this peer
	// and apply filters and strategy as before
	peers := []*registry.Peer{cached}

	// Apply filters
	filtered := peers
	for _, filter := range s.opts.Filters {
		filtered = filter(filtered)
	}

	if len(filtered) == 0 {
		return nil, registry.ErrNotFound
	}

	// Apply strategy - though with only one peer, this will always return that peer
	// unless filters removed it
	selectedPeer := s.opts.Strategy(filtered)
	return selectedPeer, nil
}

// Mark sets the status of a peer
func (s *DefaultSelector) Mark(peerName string, peer *registry.Peer, err error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if _, ok := s.status[peerName]; !ok {
		s.status[peerName] = make(map[string]int)
	}

	if err != nil {
		s.status[peerName][peer.ID]++
	} else {
		s.status[peerName][peer.ID] = 0
	}
}

// Reset resets the selector state
func (s *DefaultSelector) Reset(peer string) {
	s.mutex.Lock()
	delete(s.cache, peer)
	delete(s.status, peer)
	s.mutex.Unlock()
}

// Close closes the selector
func (s *DefaultSelector) Close() error {
	return nil
}

// Strategies

// Random is a random selection strategy
func Random(peers []*registry.Peer) *registry.Peer {
	if len(peers) == 0 {
		return nil
	}
	return peers[time.Now().UnixNano()%int64(len(peers))]
}

// RoundRobin is a round-robin selection strategy
func RoundRobin(peers []*registry.Peer) *registry.Peer {
	if len(peers) == 0 {
		return nil
	}
	return peers[time.Now().UnixNano()%int64(len(peers))]
}

// Filters

// FilterByVersion filters peers by version
func FilterByVersion(version string) Filter {
	return func(peers []*registry.Peer) []*registry.Peer {
		var filtered []*registry.Peer
		for _, peer := range peers {
			if peer.Version == version {
				filtered = append(filtered, peer)
			}
		}
		return filtered
	}
}

// FilterByMetadata filters peers by metadata
func FilterByMetadata(key, value string) Filter {
	return func(peers []*registry.Peer) []*registry.Peer {
		var filtered []*registry.Peer
		for _, peer := range peers {
			if peer.Metadata[key] == value {
				filtered = append(filtered, peer)
			}
		}
		return filtered
	}
}
