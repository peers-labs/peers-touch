// routing.go — runtime singleton for the libp2p ValueStore that federation
// consumers use to PutValue/GetValue arbitrary records into the DHT.
//
// The DHT instance is created by the bootstrap subserver alongside its libp2p
// host; we keep it out of this package so the federation package never owns a
// libp2p host or DHT directly. Instead, bootstrap.Init calls RegisterRouting
// once, and downstream consumers (the locator publisher, future federation
// resolvers) call Routing() to get the same handle.
//
// Why a singleton? A node hosts at most one federation DHT — the routing
// table is shared between the bootstrap subserver and the registry, both of
// which speak the /pst kad protocol. Multiple ValueStores in one process
// would give us multiple identities with respect to DHT writes, which is
// nonsense for federation publishing.
//
// Why ValueStore (not *dht.IpfsDHT)? routing.ValueStore is the smallest
// interface that exposes PutValue/GetValue. Callers don't need (and must not
// touch) DHT routing-table internals; binding to the smaller interface keeps
// federation consumers loosely coupled.

package federation

import (
	"sync/atomic"

	"github.com/libp2p/go-libp2p/core/routing"
)

var routingStore atomic.Value // stores routing.ValueStore

// RegisterRouting is called exactly once by the bootstrap subserver after
// dht.New() returns successfully. Calling it from anywhere else is a bug:
// federation consumers MUST go through this package, not reach into the
// bootstrap subserver's internals.
func RegisterRouting(vs routing.ValueStore) {
	if vs == nil {
		return
	}
	routingStore.Store(routingHolder{vs: vs})
}

// Routing returns the registered ValueStore, or nil if bootstrap.Init has
// not yet completed. Consumers MUST guard on nil and either retry or
// degrade — calling PutValue on a nil store would panic.
func Routing() routing.ValueStore {
	v := routingStore.Load()
	if v == nil {
		return nil
	}
	h, ok := v.(routingHolder)
	if !ok {
		return nil
	}
	return h.vs
}

// routingHolder boxes the interface so atomic.Value's "stored type must be
// identical between calls" requirement is satisfied even if we one day
// register a wrapper that satisfies routing.ValueStore but is a different
// concrete type than the original *dht.IpfsDHT.
type routingHolder struct {
	vs routing.ValueStore
}
