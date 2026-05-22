package native

import (
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
)

// configOptions binds `peers.node.registry.*` to a Go struct. The
// `bootstrap-nodes` key has been moved up to `peers.node.federation.bootstrap-nodes`
// — the registry now pulls its DHT seeds from federation.GetPolicy(), which
// is the single source of truth for every libp2p host in the process.
var configOptions struct {
	Peers struct {
		Service struct {
			Registry struct {
				ConnectTimeout string                  `pconf:"connect-timeout"`
				Interval       string                  `pconf:"interval"`
				Turn           registry.TURNAuthConfig `pconf:"turn"`
				Native         struct {
					BootstrapRefreshInterval string `pconf:"bootstrap-refresh-interval"`
					BootstrapNodeRetryTimes  int    `pconf:"bootstrap-node-retry-times"`
					MDNSEnable               bool   `pconf:"mdns-enable"`
					Libp2pIdentityKeyFile    string `pconf:"libp2p-identity-key-file"`
				} `pconf:"native"`
			} `pconf:"registry"`
		} `pconf:"node"`
		RunMode modeOpt `pconf:"run-mode"`
	} `pconf:"peers"`
}

// nativeRegistryPlugin wires native registry configuration into plugin options.
type nativeRegistryPlugin struct{}

// Name returns the plugin identifier.
func (n *nativeRegistryPlugin) Name() string {
	return plugin.NativePluginName
}

// Options converts configuration into registry options.
func (n *nativeRegistryPlugin) Options() []option.Option {
	var opts []option.Option
	if configOptions.Peers.RunMode != ModeAuto {
		opts = append(opts, WithRunningMode(configOptions.Peers.RunMode))
	}

	// Pull bootstrap-nodes from federation (single source of truth). The
	// registry takes string-form multiaddrs; federation stores them parsed,
	// so we re-stringify here to keep the registry option API stable.
	if seeds := federation.GetPolicy().BootstrapNodes; len(seeds) > 0 {
		seedStrs := make([]string, 0, len(seeds))
		for _, m := range seeds {
			seedStrs = append(seedStrs, m.String())
		}
		opts = append(opts, WithBootstrapNodes(seedStrs))
	}

	bootstrapNodeRetryTimes := 5
	if configOptions.Peers.Service.Registry.Native.BootstrapNodeRetryTimes > 0 {
		bootstrapNodeRetryTimes = configOptions.Peers.Service.Registry.Native.BootstrapNodeRetryTimes
	}
	opts = append(opts, WithBootstrapNodeRetryTimes(bootstrapNodeRetryTimes))

	interval := time.Minute * 3
	if len(configOptions.Peers.Service.Registry.Interval) > 0 {
		dur, err := time.ParseDuration(configOptions.Peers.Service.Registry.Interval)
		if err != nil {
			panic(fmt.Errorf("parse retry interval error: %s", err))
		}

		interval = dur
	}
	opts = append(opts, registry.WithInterval(interval))

	opts = append(opts, registry.WithTurnConfig(configOptions.Peers.Service.Registry.Turn))

	bootstrapRefreshInterval := time.Second * 2
	if len(configOptions.Peers.Service.Registry.Native.BootstrapRefreshInterval) > 0 {
		dur, err := time.ParseDuration(configOptions.Peers.Service.Registry.Native.BootstrapRefreshInterval)
		if err != nil {
			panic(fmt.Errorf("parse retry interval error: %s", err))
		}

		bootstrapRefreshInterval = dur
	}
	opts = append(opts, WithBootstrapRefreshInterval(bootstrapRefreshInterval))

	connectTimeout := time.Second * 10
	if len(configOptions.Peers.Service.Registry.ConnectTimeout) > 0 {
		dur, err := time.ParseDuration(configOptions.Peers.Service.Registry.ConnectTimeout)
		if err != nil {
			panic(fmt.Errorf("parse connect timeout error: %s", err))
		}

		connectTimeout = dur
	}
	opts = append(opts, registry.WithConnectTimeout(connectTimeout))
	opts = append(opts, WithMDNSEnable(configOptions.Peers.Service.Registry.Native.MDNSEnable))

	if len(configOptions.Peers.Service.Registry.Native.Libp2pIdentityKeyFile) > 0 {
		opts = append(opts, WithLibp2pIdentityKeyFile(configOptions.Peers.Service.Registry.Native.Libp2pIdentityKeyFile))
	} else {
		opts = append(opts, WithLibp2pIdentityKeyFile("libp2pIdentity.key"))
	}

	return opts
}

// New constructs a registry using plugin options.
func (n *nativeRegistryPlugin) New(opts ...option.Option) registry.Registry {
	opts = append(opts, n.Options()...)
	return NewRegistry(opts...)
}

func init() {
	config.RegisterOptions(&configOptions)
	p := &nativeRegistryPlugin{}
	plugin.RegistryPlugins[p.Name()] = p
}
