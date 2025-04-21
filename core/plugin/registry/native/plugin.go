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
				ConnectTimeout           string   `pconf:"connect-timeout"`
				RetryInterval            string   `pconf:"retry-interval"`
				BootstrapNodes           []string `pconf:"bootstrap-nodes"`
				BootstrapRefreshInterval string   `pconf:"bootstrap-refresh-interval"`
				BootstrapNodeRetryTimes  int      `json:"bootstrap-node-retry-times"`
			} `pconf:"registry"`
		} `pconf:"service"`
		RunMode ModeOpt `pconf:"run-mode"`
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
		opts = append(opts, WithDHTMode(configOptions.Peers.RunMode))
	}

	if len(configOptions.Peers.Service.Registry.BootstrapNodes) > 0 {
		opts = append(opts, WithBootstrapNodes(configOptions.Peers.Service.Registry.BootstrapNodes))
	}

	bootstrapNodeRetryTimes := 5
	if configOptions.Peers.Service.Registry.BootstrapNodeRetryTimes > 0 {
		bootstrapNodeRetryTimes = configOptions.Peers.Service.Registry.BootstrapNodeRetryTimes
	}
	opts = append(opts, WithBootstrapNodeRetryTimes(bootstrapNodeRetryTimes))

	retryInterval := time.Second * 3
	if len(configOptions.Peers.Service.Registry.RetryInterval) > 0 {
		dur, err := time.ParseDuration(configOptions.Peers.Service.Registry.RetryInterval)
		if err != nil {
			panic(fmt.Errorf("parse retry interval error: %s", err))
		}

		retryInterval = dur
	}
	opts = append(opts, registry.WithRetryInterval(retryInterval))

	bootstrapRefreshInterval := time.Second * 2
	if len(configOptions.Peers.Service.Registry.BootstrapRefreshInterval) > 0 {
		dur, err := time.ParseDuration(configOptions.Peers.Service.Registry.BootstrapRefreshInterval)
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
