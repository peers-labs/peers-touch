// routing_health.go — node-level signal for "is federation ready to
// resolve handles?". Symmetric to routing.go (which exposes the
// libp2p ValueStore singleton): this file exposes the *health* of the
// underlying routing fabric so the resolver can fail fast with 503
// instead of stalling on a 30-second DHT GetValue when the kad-DHT
// routing table is still empty.
//
// Lifecycle:
//
//   bootstrap.SubServer.createHost()        constructs DHT
//   bootstrap.SubServer.Start()             federation.RegisterRoutingHealth(s)
//   bootstrap.SubServer.Snapshot()          ← polled by GetRoutingHealth()
//
// Why a separate interface (instead of folding into routing.ValueStore)?
// ValueStore is a libp2p interface and we MUST NOT depend on it leaking
// kad-DHT internals; RoutingHealth is an in-process operational signal
// owned by the federation package — we keep both boundaries clean.

package federation

import (
	"sync/atomic"
	"time"
)

// RoutingHealth is the small interface bootstrap implements so
// downstream consumers can inspect routing readiness without seeing
// the underlying *dht.IpfsDHT or libp2p host.
type RoutingHealth interface {
	// Snapshot returns the current readiness view. Implementations
	// MUST make this cheap (no network I/O); resolver hot paths call
	// it on every request.
	Snapshot() RoutingHealthSnapshot
}

// RoutingHealthSnapshot is the wire-shape returned to consumers and
// rendered to the public /actor/federation/health endpoint.
//
// Field semantics:
//   Ready                 - true when PeersInRoutingTable >= MinDHTPeers
//                           AND the bootstrap subserver has started.
//                           Resolver gates remote lookups on this.
//   PeersInRoutingTable   - kad-DHT routing table size (peers usable
//                           for GetValue/PutValue).
//   ConnectedPeers        - libp2p host total connected peers (broader
//                           than DHT — includes direct dials, relay
//                           connections, etc.).
//   SeedsConfigured       - configured peers in federation.bootstrap-nodes
//                           after self-filter.
//   SeedsConnected        - subset of seeds currently libp2p-connected.
//   BootStartedAt         - time bootstrap.Start() began. Pre-Start
//                           returns the zero value, which Ready=false
//                           treats as "not yet running".
//   MinDHTPeers           - effective threshold (post policy clamp).
type RoutingHealthSnapshot struct {
	Ready               bool
	PeersInRoutingTable int
	ConnectedPeers      int
	SeedsConfigured     int
	SeedsConnected      int
	BootStartedAt       time.Time
	MinDHTPeers         int
}

var routingHealthSource atomic.Value // stores routingHealthHolder

// RegisterRoutingHealth is called exactly once by the bootstrap
// subserver during Start(). Calling it more than once replaces the
// previous source — useful for tests, but production code MUST stay
// single-source.
func RegisterRoutingHealth(h RoutingHealth) {
	if h == nil {
		return
	}
	routingHealthSource.Store(routingHealthHolder{h: h})
}

// GetRoutingHealth returns the current snapshot, or a zero-value
// (Ready=false) snapshot when bootstrap has not yet registered. The
// resolver treats the zero value as "not ready" so a request that
// arrives before bootstrap.Start fails fast rather than hanging.
func GetRoutingHealth() RoutingHealthSnapshot {
	v := routingHealthSource.Load()
	if v == nil {
		return RoutingHealthSnapshot{}
	}
	h, ok := v.(routingHealthHolder)
	if !ok || h.h == nil {
		return RoutingHealthSnapshot{}
	}
	return h.h.Snapshot()
}

type routingHealthHolder struct {
	h RoutingHealth
}
