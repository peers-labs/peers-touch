// host_options.go — the libp2p side of the federation contract. Every
// libp2p.New() call inside a Station should splat in the result of
// LibP2PHostOptions(); that single hook is where node-level libp2p policy
// (announced addresses, ConnectionGater, future filters) gets injected
// uniformly across the bootstrap subserver host and the transport host.

package federation

import (
	"github.com/libp2p/go-libp2p"
	ma "github.com/multiformats/go-multiaddr"
)

// LibP2PHostOptions returns the libp2p options every libp2p host in the
// process should adopt to honour the node-level federation Policy.
//
// Today this includes:
//   - libp2p.AddrsFactory(...) to publish the configured public addrs (so
//     DHT records carry externally-dialable multiaddrs even under Docker
//     / NAT, where libp2p's own interface scan returns bridge-local IPs).
//   - libp2p.ConnectionGater(...) to enforce direct-outbound / direct-
//     inbound switches when at least one is disabled.
//
// The function returns an empty slice when the Policy is fully permissive
// and has no public addrs — in that case the libp2p host is constructed
// without any federation-induced options.
func LibP2PHostOptions() []libp2p.Option {
	return libP2PHostOptionsFromPolicy(GetPolicy())
}

// LibP2PHostOptionsFromPolicy is the testable variant: callers build a
// Policy in memory and ask for its libp2p options without touching the
// package singleton.
func LibP2PHostOptionsFromPolicy(p Policy) []libp2p.Option {
	return libP2PHostOptionsFromPolicy(p)
}

func libP2PHostOptionsFromPolicy(p Policy) []libp2p.Option {
	var opts []libp2p.Option

	if len(p.PublicAddrs) > 0 {
		// AddrsFactory replaces the default "advertise everything we can
		// reach locally" behaviour with the explicit public-addrs list.
		// Discovered addresses are dropped on purpose: announcing
		// 172.x bridge IPs to the DHT is actively harmful (other peers
		// will dial them and fail).
		announced := append([]ma.Multiaddr(nil), p.PublicAddrs...)
		opts = append(opts, libp2p.AddrsFactory(func(_ []ma.Multiaddr) []ma.Multiaddr {
			return announced
		}))
	}

	if gp := p.GaterPolicy(); gp.Active() {
		opts = append(opts, libp2p.ConnectionGater(NewGater(gp)))
	}

	return opts
}
