// seeds.go — helpers to convert federation seed multiaddrs into the shapes
// libp2p / kad-dht consumers expect. All helpers operate on a Policy
// snapshot so callers don't have to reach into the package singleton if
// they already have a Policy in hand.

package federation

import (
	"github.com/libp2p/go-libp2p/core/peer"
	ma "github.com/multiformats/go-multiaddr"
)

// BootstrapSeeds returns the federation bootstrap-nodes parsed into
// AddrInfo records ready for kad-dht's BootstrapPeers option or for direct
// host.Connect calls. Self-referential seeds (the caller's own peer ID) are
// not filtered here — that's a host-local concern; the host's DHT layer
// already drops self entries. Addresses without a /p2p/<peer-id> component
// are skipped because they cannot be turned into AddrInfo records.
func BootstrapSeeds() []peer.AddrInfo {
	return seedsFromMultiaddrs(GetPolicy().BootstrapNodes)
}

// SeedsFromMultiaddrs is exported for callers that need to compute seeds
// from a custom multiaddr slice — for example, plugin tests that build a
// Policy in memory without touching the package singleton.
func SeedsFromMultiaddrs(addrs []ma.Multiaddr) []peer.AddrInfo {
	return seedsFromMultiaddrs(addrs)
}

func seedsFromMultiaddrs(addrs []ma.Multiaddr) []peer.AddrInfo {
	out := make([]peer.AddrInfo, 0, len(addrs))
	for _, a := range addrs {
		info, err := peer.AddrInfoFromP2pAddr(a)
		if err != nil {
			continue
		}
		out = append(out, *info)
	}
	return out
}

// allowedPeerSet derives the gater allow list from a multiaddr slice.
// Identical logic to seedsFromMultiaddrs, but returns a set keyed by
// peer.ID for O(1) gater lookup.
func allowedPeerSet(addrs []ma.Multiaddr) map[peer.ID]struct{} {
	out := make(map[peer.ID]struct{}, len(addrs))
	for _, a := range addrs {
		info, err := peer.AddrInfoFromP2pAddr(a)
		if err != nil {
			continue
		}
		out[info.ID] = struct{}{}
	}
	return out
}
