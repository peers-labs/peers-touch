// identity.go — runtime singleton for the local station's federation-visible
// identity. The values are NOT known at config-load time:
//
//   - StationPeerID is derived from the persistent logical Station root key.
//     It is independent from every process node's libp2p PeerID.
//   - StationDomain is the DNS-style host portion of `peers.node.server.baseurl`.
//     Available immediately at boot but cached here next to PeerID so every
//     federation consumer reads ONE struct.
//
// Consumers (locator publisher, federation auth mint, future resolver) call
// LocalIdentity() and accept the half-populated zero-state during very early
// boot — the only legitimate caller before bootstrap.Init has finished is the
// config dump, and it can tolerate empty fields. Anyone who actually NEEDS
// the PeerID guards on `id.StationPeerID == ""` and bails / retries.
//
// The package only exposes a single shared snapshot — no per-tenant identity
// — because a station hosts exactly one federation persona by design.

package federation

import (
	"sync"
	"sync/atomic"

	"github.com/libp2p/go-libp2p/core/peer"
)

// LocalIdentity captures everything a federation consumer needs to identify
// the local station to remote peers.
type LocalIdentity struct {
	// StationPeerID is the stable logical Station identity. May be empty
	// before bootstrap.Init publishes the root-derived value.
	StationPeerID peer.ID

	// StationDomain is the DNS-style HTTP host portion of the configured
	// peers.node.server.baseurl (no scheme, no trailing slash, no port
	// stripped — port is preserved because the federated handle is rendered
	// "@user@host:port" when port is non-default and operators expect
	// round-trips). May be empty until SetLocalStationDomain is called.
	StationDomain string
}

var (
	localIdentity       atomic.Value // stores LocalIdentity
	localIdentityUpdate sync.Mutex
)

// SetLocalStationPeerID is called exactly once by the bootstrap subserver
// after loading the logical Station root. Repeated calls overwrite, but in
// production the logical identity is published once per process.
func SetLocalStationPeerID(id peer.ID) {
	localIdentityUpdate.Lock()
	defer localIdentityUpdate.Unlock()
	cur := loadIdentity()
	cur.StationPeerID = id
	localIdentity.Store(cur)
}

// SetLocalStationDomain is called from main during config-load, just after
// peers.yml is materialised. The value is the parsed Host of
// peers.node.server.baseurl.
func SetLocalStationDomain(domain string) {
	localIdentityUpdate.Lock()
	defer localIdentityUpdate.Unlock()
	cur := loadIdentity()
	cur.StationDomain = domain
	localIdentity.Store(cur)
}

// LocalIdentitySnapshot returns the current local identity. Safe to call
// before either setter has run — the returned struct will have empty fields,
// and consumers must guard accordingly.
func LocalIdentitySnapshot() LocalIdentity {
	return loadIdentity()
}

func loadIdentity() LocalIdentity {
	if v := localIdentity.Load(); v != nil {
		return v.(LocalIdentity)
	}
	return LocalIdentity{}
}
