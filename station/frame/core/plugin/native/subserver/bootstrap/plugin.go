package bootstrap

import (
	"time"

	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

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
						BootstrapNodes     []string      `pconf:"bootstrap-nodes"`
						DHTRefreshInterval time.Duration `pconf:"dht-refresh-interval"`
					} `pconf:"bootstrap"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type bootstrap struct{}

func (p *bootstrap) Name() string {
	return "bootstrap"
}

func (p *bootstrap) Options() []option.Option {
	var opts []option.Option

	opts = append(opts, WithEnabled(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.Enabled))
	opts = append(opts, WithListenAddrs(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.ListenAddrs))

	if len(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.BootstrapNodes) != 0 {
		nodes := bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.BootstrapNodes
		for i := range nodes {
			addr, err := multiaddr.NewMultiaddr(nodes[i])
			if err != nil {
				panic(err)
			}

			opts = append(opts, WithBootstrapNodes([]multiaddr.Multiaddr{addr}))
		}
	}

	opts = append(opts, WithDHTRefreshInterval(bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.DHTRefreshInterval*time.Second))
	return opts
}

func (p *bootstrap) Enabled() bool {
	return bootstrapOptions.Peers.Node.Server.Subserver.Bootstrap.Enabled
}

func (p *bootstrap) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)

	return NewBootstrapServer(opts...)
}

func init() {
	config.RegisterOptions(&bootstrapOptions)
	plugin.SubserverPlugins["bootstrap"] = &bootstrap{}
}
