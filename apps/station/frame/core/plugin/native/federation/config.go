// config.go — wiring between the YAML configuration system and the
// federation Policy. The package owns:
//
//   - the `peers.node.federation.*` schema (registered with config so all
//     other plugins / subservers can ignore those keys entirely);
//   - the package-level Policy singleton, populated lazily on first read;
//   - SetForTest, the only sanctioned override path for test code.
//
// Every consumer of node-level federation policy (libp2p host construction,
// DHT seeding, ConnectionGater wiring) reaches for GetPolicy(); they MUST
// NOT try to re-derive the same values from raw config keys, because the
// config key shape is an implementation detail of this package.

package federation

import (
	"context"
	"strings"
	"sync"

	ma "github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// configOptions binds `peers.node.federation.*` to a Go struct. The struct
// is populated by the config loader before any plugin runs Options(), so
// GetPolicy() is safe to call from any plugin's Options() hook.
//
// DirectOutbound / DirectInbound are plain bool: the Go zero value (false)
// is not the right default — federation.yml supplies `direct-outbound: true`
// and `direct-inbound: true` so an unconfigured node ends up permissive.
// The hierarchy-merge engine layers federation.docker.yml on top, so env
// overrides like PEERS_FEDERATION_DIRECT_OUTBOUND=false work as expected.
var configOptions struct {
	Peers struct {
		Node struct {
			Federation struct {
				BootstrapNodes []string `pconf:"bootstrap-nodes"`
				PublicAddrs    []string `pconf:"public-addrs"`
				DirectOutbound bool     `pconf:"direct-outbound"`
				DirectInbound  bool     `pconf:"direct-inbound"`

				// RepublishIntervalSec controls how often the locator
				// republisher walks every visible local actor and re-emits
				// its DHT record. Default 12h matches half the kad-DHT
				// expiry; values below 30s are clamped by the republisher
				// itself. Zero means "use default", not "disable" — the
				// only sanctioned way to disable republish is to set the
				// Disabled flag.
				RepublishIntervalSec int  `pconf:"republish-interval-sec"`
				RepublishDisabled    bool `pconf:"republish-disabled"`

				// MinDhtPeers is the readiness threshold for the resolver
				// gate (Phase E.2). Below this peer count in the kad-DHT
				// routing table, ResolveByHandle returns ErrFederationNotReady
				// (HTTP 503) rather than burning the caller's request on a
				// guaranteed-stalled GetValue. Default 1 — with at least
				// one seed connected the routing table fills via DHT
				// announce within seconds. Production deployments may
				// raise this to e.g. 3 to require a quorum of seeds.
				// Zero means "use default" (1); to fully disable the gate
				// set it to a negative value.
				MinDhtPeers int `pconf:"min-dht-peers"`
			} `pconf:"federation"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

var (
	policyOnce sync.Once
	policyVal  Policy
	policyMu   sync.RWMutex
)

// GetPolicy returns the node-level federation Policy snapshot. The first
// call materialises the snapshot from configOptions; subsequent calls
// return the same value. The result is safe to share across goroutines.
//
// All defaults live in apps/station/app/conf/federation.yml — including
// the permissive "direct-outbound: true / direct-inbound: true" defaults
// that prevent a node with no federation overlay from accidentally
// installing a connection-blocking gater.
func GetPolicy() Policy {
	policyOnce.Do(initPolicyFromConfig)

	policyMu.RLock()
	defer policyMu.RUnlock()
	return policyVal
}

// SetForTest replaces the package singleton. Only test code should call
// this; production code reaches GetPolicy() via the normal config path.
// The function is exported (capitalised) so test packages outside this
// package can use it.
func SetForTest(p Policy) {
	policyMu.Lock()
	defer policyMu.Unlock()
	policyVal = p
	// Also mark the once as triggered so a subsequent GetPolicy() does
	// not re-initialise from configOptions and clobber the test value.
	policyOnce.Do(func() {})
}

func initPolicyFromConfig() {
	c := configOptions.Peers.Node.Federation

	policy := Policy{
		BootstrapNodes:       parseMultiaddrs("federation.bootstrap-nodes", c.BootstrapNodes),
		PublicAddrs:          parseMultiaddrs("federation.public-addrs", c.PublicAddrs),
		DirectOutbound:       c.DirectOutbound,
		DirectInbound:        c.DirectInbound,
		RepublishIntervalSec: c.RepublishIntervalSec,
		RepublishDisabled:    c.RepublishDisabled,
		MinDHTPeers:          c.MinDhtPeers,
	}

	policyMu.Lock()
	policyVal = policy
	policyMu.Unlock()
}

// parseMultiaddrs converts a string slice from YAML into validated
// multiaddrs. Invalid entries are logged with their key for operator
// visibility but do not abort startup — a single malformed seed should not
// take the whole node down.
func parseMultiaddrs(key string, raw []string) []ma.Multiaddr {
	out := make([]ma.Multiaddr, 0, len(raw))
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		m, err := ma.NewMultiaddr(s)
		if err != nil {
			logger.Errorf(context.Background(), "[federation] %s: ignoring invalid multiaddr %q: %v", key, s, err)
			continue
		}
		out = append(out, m)
	}
	return out
}

func init() {
	config.RegisterOptions(&configOptions)
}
