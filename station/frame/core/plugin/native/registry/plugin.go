package native

import (
	"fmt"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
)

var configOptions struct {
	Peers struct {
		Service struct {
			Registry struct {
				ConnectTimeout string                  `pconf:"connect-timeout"`
				Interval       string                  `pconf:"interval"`
				Turn           registry.TURNAuthConfig `pconf:"turn"`
				Native         struct {
					BootstrapNodes           []string `pconf:"bootstrap-nodes"`
					BootstrapRefreshInterval string   `pconf:"bootstrap-refresh-interval"`
					BootstrapNodeRetryTimes  int      `pconf:"bootstrap-node-retry-times"`
					MDNSEnable               bool     `pconf:"mdns-enable"`
					BootstrapEnable          bool     `pconf:"bootstrap-enable"`
					BootstrapToSelf          bool     `pconf:"bootstrap-to-self"`
					BootstrapListenAddrs     []string `pconf:"bootstrap-listen-addrs"`
					Libp2pIdentityKeyFile    string   `pconf:"libp2p-identity-key-file"`
				} `pconf:"native"`
			} `pconf:"registry"`
		} `pconf:"node"`
		RunMode modeOpt `pconf:"run-mode"`
	} `pconf:"peers"`
}

type nativeRegistryPlugin struct {
}

func (n *nativeRegistryPlugin) Name() string {
	return plugin.NativePluginName
}

func (n *nativeRegistryPlugin) Options() []option.Option {
	var opts []option.Option
	if configOptions.Peers.RunMode != ModeAuto {
		opts = append(opts, WithRunningMode(configOptions.Peers.RunMode))
	}

	if len(configOptions.Peers.Service.Registry.Native.BootstrapNodes) > 0 {
		opts = append(opts, WithBootstrapNodes(configOptions.Peers.Service.Registry.Native.BootstrapNodes))
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
	opts = append(opts, WithBootstrapEnable(configOptions.Peers.Service.Registry.Native.BootstrapEnable))
	opts = append(opts, WithBootstrapEnable(configOptions.Peers.Service.Registry.Native.BootstrapToSelf))
	opts = append(opts, WithBootstrapListenAddrs(configOptions.Peers.Service.Registry.Native.BootstrapListenAddrs...))

	opts = append(opts, WithMDNSEnable(configOptions.Peers.Service.Registry.Native.MDNSEnable))

	if len(configOptions.Peers.Service.Registry.Native.Libp2pIdentityKeyFile) > 0 {
		opts = append(opts, WithLibp2pIdentityKeyFile(configOptions.Peers.Service.Registry.Native.Libp2pIdentityKeyFile))
	} else {
		opts = append(opts, WithLibp2pIdentityKeyFile("libp2pIdentity.key"))
	}

	return opts
}

func (n *nativeRegistryPlugin) New(opts ...option.Option) registry.Registry {
	opts = append(opts, n.Options()...)
	return NewRegistry(opts...)
}

func init() {
	config.RegisterOptions(&configOptions)
	p := &nativeRegistryPlugin{}
	plugin.RegistryPlugins[p.Name()] = p
}
