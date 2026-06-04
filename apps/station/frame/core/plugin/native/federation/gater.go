// gater.go — libp2p ConnectionGater implementation that enforces the
// federation-direct switches. The gater operates on a snapshot of policy
// state passed in at construction time, so each libp2p host gets its own
// gater instance and no shared mutable state crosses host boundaries.

package federation

import (
	"github.com/libp2p/go-libp2p/core/connmgr"
	"github.com/libp2p/go-libp2p/core/control"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	ma "github.com/multiformats/go-multiaddr"
)

// GaterPolicy is the slice of node-level Policy that a Gater needs at
// runtime. It is derived from the full Policy via Policy.GaterPolicy().
// AllowedPeers is the closed set of peer IDs that bypass the direction
// switches — typically the federation seeds.
type GaterPolicy struct {
	DirectOutbound bool
	DirectInbound  bool
	AllowedPeers   map[peer.ID]struct{}
}

// Active reports whether the policy is doing any gating. When false the
// caller can skip wiring the Gater into libp2p entirely; the resulting
// host has no ConnectionGater installed and behaves like vanilla libp2p.
func (p GaterPolicy) Active() bool {
	return !p.DirectOutbound || !p.DirectInbound
}

// Gater is the libp2p ConnectionGater that enforces a GaterPolicy. Each
// libp2p host in the process gets its own Gater instance — they are cheap
// to construct and there is no shared state.
type Gater struct {
	policy GaterPolicy
}

// NewGater builds a Gater for the supplied policy. The constructor is the
// only sanctioned way to create a Gater; the zero-Policy state (both
// directions disabled, empty allow list) would block ALL libp2p
// connectivity, which is never what callers want.
func NewGater(p GaterPolicy) *Gater {
	return &Gater{policy: p}
}

// Compile-time assertion: any future ConnectionGater interface change in
// go-libp2p will fail this build immediately, before any traffic is gated
// incorrectly.
var _ connmgr.ConnectionGater = (*Gater)(nil)

// InterceptPeerDial enforces the outbound switch. Returning false here
// aborts the dial before any TCP / Noise work happens — the cheapest hook
// libp2p offers, and the only one with full peer.ID context for outbound.
func (g *Gater) InterceptPeerDial(p peer.ID) bool {
	if g.policy.DirectOutbound {
		return true
	}
	_, ok := g.policy.AllowedPeers[p]
	return ok
}

// InterceptAddrDial defers to InterceptPeerDial: the policy is per peer,
// not per address. Returning a different verdict here would silently allow
// some addresses of a blocked peer through, contradicting the switch's
// intent.
func (g *Gater) InterceptAddrDial(p peer.ID, _ ma.Multiaddr) bool {
	return g.InterceptPeerDial(p)
}

// InterceptAccept always allows the raw TCP accept: at this point we don't
// yet know the remote peer.ID and rejecting on raw addresses would risk
// blacklisting shared NATs by accident. The real inbound gating happens in
// InterceptSecured.
func (g *Gater) InterceptAccept(_ network.ConnMultiaddrs) bool {
	return true
}

// InterceptSecured enforces the inbound switch — the first hook that knows
// the remote peer.ID with cryptographic certainty (after Noise/TLS).
// Outbound connections also pass through here; we let those through
// because they were already vetted in InterceptPeerDial.
func (g *Gater) InterceptSecured(dir network.Direction, p peer.ID, _ network.ConnMultiaddrs) bool {
	if dir == network.DirOutbound {
		return true
	}
	if g.policy.DirectInbound {
		return true
	}
	_, ok := g.policy.AllowedPeers[p]
	return ok
}

// InterceptUpgraded is a no-op: by the time stream-multiplexer negotiation
// happens, the connection has already been vetted. The switches only
// target the establishment phase, not session lifetime.
func (g *Gater) InterceptUpgraded(_ network.Conn) (bool, control.DisconnectReason) {
	return true, 0
}
