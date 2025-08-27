package bootstrap

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/multiformats/go-multiaddr"
)

var bootstrapOptions struct {
	Peers struct {
		Service struct {
			Server struct {
				Subserver struct {
					Bootstrap struct {
						Enabled            bool          `pconf:"enabled"`
						EnableMDNS         bool          `pconf:"enable-mdns"`
						IdentityKey        string        `pconf:"identity-key"`
						ListenAddrs        []string      `pconf:"listen-addrs"`
						BootstrapNodes     []string      `pconf:"bootstrap-nodes"`
						DHTRefreshInterval time.Duration `pconf:"dht-refresh-interval"`
					} `pconf:"bootstrap"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"service"`
	} `pconf:"peers"`
}

type bootstrap struct{}

func (p *bootstrap) Name() string {
	return "turn"
}

func (p *bootstrap) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.Enabled))
	opts = append(opts, WithListenAddrs(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.ListenAddrs))
	opts = append(opts, WithMDNS(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.EnableMDNS))

	if len(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.BootstrapNodes) != 0 {
		nodes := bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.BootstrapNodes
		for i := range nodes {
			addr, err := multiaddr.NewMultiaddr(nodes[i])
			if err != nil {
				panic(err)
			}

			opts = append(opts, WithBootstrapNodes([]multiaddr.Multiaddr{addr}))
		}
	}

	if len(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.IdentityKey) > 0 {
		key, err := loadOrGenerateKey(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.IdentityKey)
		if err != nil {
			panic(err)
		}

		opts = append(opts, WithIdentityKey(key))
	}

	opts = append(opts, WithDHTRefreshInterval(bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.DHTRefreshInterval*time.Second))
	return opts
}

func (p *bootstrap) Enabled() bool {
	return bootstrapOptions.Peers.Service.Server.Subserver.Bootstrap.Enabled
}

func (p *bootstrap) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)

	return NewBootstrapServer(opts...)
}

func init() {
	config.RegisterOptions(&bootstrapOptions)
	plugin.SubserverPlugins["bootstrap"] = &bootstrap{}
}
