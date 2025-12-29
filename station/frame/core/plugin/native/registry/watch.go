package native

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
)

// Watch emits add/update/delete events for peers via callbacks.
func (r *nativeRegistry) Watch(ctx context.Context, callback registry.WatchCallback, opts ...registry.WatchOption) error {
	watchOpts := &registry.WatchOptions{}
	for _, opt := range opts {
		opt(watchOpts)
	}

	go r.peerDiscoveryWatcher(ctx, callback, watchOpts)
	go r.connectivityWatcher(ctx, callback, watchOpts)
	return nil
}

func (r *nativeRegistry) peerDiscoveryWatcher(ctx context.Context, callback registry.WatchCallback, opts *registry.WatchOptions) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	knownPeers := make(map[string]bool)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			peers, err := r.listPeers(ctx, &registry.QueryOptions{})
			if err != nil {
				logger.Errorf(ctx, "[peerDiscoveryWatcher] failed to list peers: %v", err)

				continue
			}

			for _, peer := range peers {
				if !knownPeers[peer.Name] {
					knownPeers[peer.Name] = true
					registration := &registry.Registration{
						ID:         peer.Name,
						Name:       peer.Name,
						Type:       "peer",
						Namespaces: []string{"dht"},
						Metadata:   peer.Metadata,
					}
					callback(registry.WatchEvent{
						Type:         registry.WatchEventAdd,
						Registration: registration,
						Timestamp:    time.Now(),
						Namespace:    "dht",
					})
				}
			}

			for knownPeer := range knownPeers {
				found := false
				for _, peer := range peers {
					if peer.Name == knownPeer {
						found = true
						break
					}
				}
				if !found {
					delete(knownPeers, knownPeer)
					callback(registry.WatchEvent{
						Type:         registry.WatchEventDelete,
						Registration: &registry.Registration{ID: knownPeer, Name: knownPeer, Type: "peer"},
						Timestamp:    time.Now(),
						Namespace:    "dht",
					})
				}
			}
		}
	}
}

func (r *nativeRegistry) connectivityWatcher(ctx context.Context, callback registry.WatchCallback, opts *registry.WatchOptions) {
	if r.host == nil {
		return
	}

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	connectedPeers := make(map[string]bool)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			currentPeers := r.host.Network().Peers()

			for _, peerID := range currentPeers {
				peerStr := peerID.String()
				if !connectedPeers[peerStr] {
					connectedPeers[peerStr] = true
					addrs := r.host.Peerstore().Addrs(peerID)
					addrStrings := make([]string, len(addrs))
					for i, addr := range addrs {
						addrStrings[i] = addr.String()
					}
					callback(registry.WatchEvent{
						Type:         registry.WatchEventUpdate,
						Registration: &registry.Registration{ID: peerStr, Name: peerStr, Type: "peer", Namespaces: []string{"network"}, Addresses: addrStrings},
						Timestamp:    time.Now(),
						Namespace:    "network",
					})
				}
			}

			for connectedPeer := range connectedPeers {
				found := false
				for _, peerID := range currentPeers {
					if peerID.String() == connectedPeer {
						found = true
						break
					}
				}
				if !found {
					delete(connectedPeers, connectedPeer)
					callback(registry.WatchEvent{
						Type:         registry.WatchEventUpdate,
						Registration: &registry.Registration{ID: connectedPeer, Name: connectedPeer, Type: "peer"},
						Timestamp:    time.Now(),
						Namespace:    "network",
					})
				}
			}
		}
	}
}
