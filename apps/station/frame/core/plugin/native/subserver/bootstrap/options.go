// Package bootstrap exposes option helpers for the bootstrap subserver.
package bootstrap

import (
	"crypto/sha256"
	"time"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// Options holds configuration for the bootstrap subserver.
//
// Federation-level concerns (bootstrap-nodes, public-addrs, direct-outbound,
// direct-inbound) live in the federation package, not here. The bootstrap
// subserver's createHost reads them via federation.GetPolicy() and
// federation.LibP2PHostOptions(); tests inject custom policies via
// federation.SetForTest. This keeps Options scoped to per-host concerns:
// identity, listen addrs, mDNS, security mode.
type Options struct {
	*option.Options

	Enabled            bool
	EnableMDNS         bool
	StationRootKey     crypto.PrivKey
	StationDomain      string
	InnerTLSSPKISHA256 [sha256.Size]byte
	CircuitRoutes      func(time.Time) []nativeRelay.CircuitRoute
	DHTRefreshInterval time.Duration
	Host               host.Host
	DHT                *dht.IpfsDHT
}

// WithKernel injects the process-wide P2P Kernel resources.
func WithKernel(valueHost host.Host, valueDHT *dht.IpfsDHT) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Host = valueHost
		o.DHT = valueDHT
	})
}

// WithStationRootKey sets the persistent logical Station identity key.
func WithStationRootKey(key crypto.PrivKey) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.StationRootKey = key
	})
}

// WithStationDomain sets the logical Station's signed domain projection.
func WithStationDomain(domain string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.StationDomain = domain
	})
}

// WithCircuitRoutes projects current standard Relay reservations.
func WithCircuitRoutes(
	innerTLSSPKISHA256 [sha256.Size]byte,
	routes func(time.Time) []nativeRelay.CircuitRoute,
) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.InnerTLSSPKISHA256 = innerTLSSPKISHA256
		o.CircuitRoutes = routes
	})
}

// WithMDNS toggles MDNS discovery.
func WithMDNS(enable bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.EnableMDNS = enable
	})
}

// WithEnabled toggles the bootstrap subserver.
func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

// WithDHTRefreshInterval sets DHT refresh interval.
func WithDHTRefreshInterval(dhtRefreshInterval time.Duration) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.DHTRefreshInterval = dhtRefreshInterval
	})
}
