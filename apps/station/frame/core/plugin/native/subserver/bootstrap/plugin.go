package bootstrap

import (
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// bootstrapOptions binds `peers.node.server.subserver.bootstrap.*` to a Go
// struct. Only per-host concerns live here. Federation-level keys
// (bootstrap-nodes, public-addrs, direct-outbound, direct-inbound) are bound
// by the federation package — see apps/station/frame/core/plugin/native/
// federation/config.go.
var bootstrapOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Bootstrap struct {
						Enabled            bool          `pconf:"enabled"`
						EnableMDNS         bool          `pconf:"enable-mdns"`
						IdentityKey        string        `pconf:"identity-key"`
						ListenAddrs        []string      `pconf:"listen-addrs"`
						DHTRefreshInterval time.Duration `pconf:"dht-refresh-interval"`
						Libp2pInsecure     bool          `pconf:"libp2p-insecure"`
					} `pconf:"bootstrap"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type bootstrap struct{}

// Name returns the plugin identifier.
func (p *bootstrap) Name() string {
	return "bootstrap"
}

// Options converts configuration into subserver options. Federation-level
// concerns are NOT translated into options here — the subserver pulls them
// from federation.GetPolicy() at host-construction time so production code
// and tests share one source of truth.
func (p *bootstrap) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.Enabled))
	opts = append(opts, WithListenAddrs(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.ListenAddrs))
	opts = append(opts, WithMDNS(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.EnableMDNS))
	opts = append(opts, WithLibp2pInsecure(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.Libp2pInsecure))

	keyPath := bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.IdentityKey
	if keyPath == "" {
		keyPath = "bootstrap.key"
	}
	privKey, err := loadOrGenerateKey(keyPath)
	if err != nil {
		panic(fmt.Errorf("failed to load identity key from %s: %w", keyPath, err))
	}
	opts = append(opts, WithIdentityKey(privKey))
	opts = append(opts, WithPrivateKey(privKey))

	dhtRefreshInterval := bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.DHTRefreshInterval
	if dhtRefreshInterval == 0 {
		dhtRefreshInterval = 30
	}
	opts = append(opts, WithDHTRefreshInterval(dhtRefreshInterval*time.Second))

	return opts
}

// Enabled reports whether the bootstrap subserver is enabled.
func (p *bootstrap) Enabled() bool {
	return bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.Enabled
}

// New constructs a new bootstrap subserver with plugin options.
func (p *bootstrap) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewBootstrapServer(opts...)
}

func init() {
	config.RegisterOptions(&bootstrapOptions)
	plugin.SubserverPlugins["bootstrap"] = &bootstrap{}
}
