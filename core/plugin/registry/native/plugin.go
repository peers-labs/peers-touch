package native

import (
	"fmt"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

var configOptions struct {
	Peers struct {
		Service struct {
			Registry struct {
				Native struct {
					BootstrapNodes           []string `pconf:"bootstrap-nodes"`
					BootstrapRefreshInterval string   `pconf:"bootstrap-refresh-interval"`
					BootstrapNodeRetryTimes  int      `pconf:"bootstrap-node-retry-times"`
					MDNSEnable               bool     `pconf:"mdns-endable"`
					BootstrapEnable          bool     `pconf:"bootstrap-enable"`
					BootstrapListenAddrs     []string `pconf:"bootstrap-listen-addrs"`
					Libp2pIdentityKeyFile    string   `pconf:"libp2p-identity-key-file"`
				} `pconf:"native"`
				ConnectTimeout string `pconf:"connect-timeout"`
				Interval       string `pconf:"interval"`
			} `pconf:"registry"`
		} `pconf:"service"`
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
