// policy.go — the top-level node-level federation Policy. Every consumer of
// federation policy in the process (libp2p host construction, DHT seed
// selection, gater wiring) reads from a Policy instance.
//
// Policy is a value type built from configuration at boot time. It is then
// stored as the package singleton (see config.go) for downstream consumers
// to retrieve via GetPolicy(). Tests use SetForTest() to inject specific
// policies without touching the config system.

package federation

import (
	ma "github.com/multiformats/go-multiaddr"
)

// Policy is the full node-level federation contract. Fields are deliberately
// scalar / slice so the struct is trivially copyable and any concurrent
// reader holds an immutable snapshot.
type Policy struct {
	// BootstrapNodes is the federation seed list, expressed as parsed
	// multiaddrs that include a /p2p/<peer-id> component. These addrs are
	// fed to every libp2p host's DHT (bootstrap subserver + registry) and
	// are also the source of truth for the gater's allow list.
	BootstrapNodes []ma.Multiaddr

	// PublicAddrs is the multiaddr list this node announces to the libp2p
	// network. It overrides the addrs libp2p discovers from local
	// interfaces, which is essential under Docker / NAT where the local
	// bridge IP (172.x) is not externally dialable. When empty, libp2p
	// falls back to its own discovery (correct on bare metal).
	PublicAddrs []ma.Multiaddr

	// DirectOutbound: when false, the gater restricts outbound libp2p
	// dials to BootstrapNodes only. When true, the gater is permissive
	// outbound (the node is a normal participant).
	DirectOutbound bool

	// DirectInbound: when false, the gater restricts accepted inbound
	// libp2p connections to BootstrapNodes only. When true, the gater is
	// permissive inbound.
	DirectInbound bool

	// RepublishIntervalSec is the locator republisher's scan period in
	// seconds. Zero means "use the package default" — federated
	// consumers reach for federation/republisher.DefaultInterval rather
	// than re-encoding the constant here.
	RepublishIntervalSec int

	// RepublishDisabled, when true, suppresses the locator republisher
	// entirely. Operators set this for headless test rigs where DHT
	// expiry is not a concern; production stations leave it false.
	RepublishDisabled bool

	// MinDHTPeers is the readiness threshold the resolver / health
	// endpoint use to decide whether the federation is "joined".
	// Zero means "use the package default" — RoutingHealth consumers
	// fall back to 1. Negative means "disable the gate" (ResolveByHandle
	// will never return ErrFederationNotReady).
	MinDHTPeers int
}

// GaterPolicy projects the subset of Policy that the libp2p Gater needs.
// The projection happens here (not inside the gater) so the gater stays a
// pure library type — it can be reused by anything that has a GaterPolicy,
// not just nodes that read from federation config.
func (p Policy) GaterPolicy() GaterPolicy {
	return GaterPolicy{
		DirectOutbound: p.DirectOutbound,
		DirectInbound:  p.DirectInbound,
		AllowedPeers:   allowedPeerSet(p.BootstrapNodes),
	}
}
