package registry

import (
	"context"
	"fmt"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
)

var (
	// DefaultPeersNetworkNamespace is the default namespace for peers-touch network.
	// pst equals to peers-touch
	DefaultPeersNetworkNamespace = "pst"
)

var (
	registrys       map[string]Registry = map[string]Registry{}
	defaultRegistry Registry
	registryMutex   sync.Mutex
)

// Register adds a registry implementation to the global registry list
func Register(r Registry) {
	registryMutex.Lock()
	defer registryMutex.Unlock()

	if _, ok := registrys[r.String()]; ok {
		logger.Errorf(context.Background(), "registry %s already registered", r.String())
		return
	}

	registrys[r.String()] = r

	// Set as default if it's the first registry or if IsDefault is true
	if defaultRegistry == nil || r.Options().IsDefault {
		defaultRegistry = r
	}
}

// GetPeer retrieves a peer using the default registry
func GetPeer(ctx context.Context, opts ...GetOption) (*Peer, error) {
	if defaultRegistry == nil {
		return nil, fmt.Errorf("no default registry set")
	}
	return defaultRegistry.GetPeer(ctx, opts...)
}

// ListPeers retrieves all peers using the default registry
func ListPeers(ctx context.Context, opts ...GetOption) ([]*Peer, error) {
	if defaultRegistry == nil {
		return nil, fmt.Errorf("no default registry set")
	}
	return defaultRegistry.ListPeers(ctx, opts...)
}

// GetDefaultRegistry returns the current default registry
func GetDefaultRegistry() Registry {
	registryMutex.Lock()
	defer registryMutex.Unlock()
	return defaultRegistry
}

// GetRegistries returns all registered registries
func GetRegistries() map[string]Registry {
	registryMutex.Lock()
	defer registryMutex.Unlock()
	return registrys
}
