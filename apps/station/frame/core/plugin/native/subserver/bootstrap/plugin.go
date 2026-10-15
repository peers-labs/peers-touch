package bootstrap

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
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
				BaseURL   string `pconf:"baseurl"`
				Subserver struct {
					Bootstrap struct {
						Enabled            bool          `pconf:"enabled"`
						EnableMDNS         bool          `pconf:"enable-mdns"`
						StationRootKeyFile string        `pconf:"station-root-key-file"`
						DHTRefreshInterval time.Duration `pconf:"dht-refresh-interval"`
					} `pconf:"bootstrap"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type bootstrap struct{}

// StationRootKey returns the persistent logical Station identity. It is
// independent from the process Host key.
func StationRootKey() (crypto.PrivKey, error) {
	rootKeyPath := bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.StationRootKeyFile
	if rootKeyPath == "" {
		rootKeyPath = "bootstrap.key"
	}
	rootKey, err := loadOrGenerateKey(rootKeyPath)
	if err != nil {
		return nil, fmt.Errorf(
			"load logical Station root from %s: %w",
			rootKeyPath,
			err,
		)
	}
	return rootKey, nil
}

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
	opts = append(opts, WithMDNS(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.EnableMDNS))
	opts = append(
		opts,
		WithStationDomain(
			stationDomain(bootstrapOptions.Peers.Node.Server.BaseURL),
		),
	)

	rootKey, err := StationRootKey()
	if err != nil {
		panic(err)
	}
	opts = append(opts, WithStationRootKey(rootKey))

	dhtRefreshInterval := bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.DHTRefreshInterval
	if dhtRefreshInterval == 0 {
		dhtRefreshInterval = 30
	}
	opts = append(opts, WithDHTRefreshInterval(dhtRefreshInterval*time.Second))

	return opts
}

func stationDomain(origin string) string {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || parsed.User != nil || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	return strings.ToLower(parsed.Host)
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
