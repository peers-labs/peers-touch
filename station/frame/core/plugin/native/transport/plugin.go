package native

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

var (
	transportConfig = TransportConfig{}
)

type TransportConfig struct {
	Peers struct {
		Node struct {
			Transport struct {
				Name   string   `json:"name" pconf:"name"`
				Addrs  []string `json:"addrs" pconf:"addrs"`
				Native struct {
					EnableRelay           bool   `json:"enable-relay" pconf:"enable-relay"`
					Libp2pIdentityKeyFile string `json:"libp2p-identity-key-file" pconf:"libp2p-identity-key-file"`
				} `json:"native" pconf:"native"`

				Secure  bool   `json:"secure" pconf:"secure"`
				Timeout string `json:"timeout" pconf:"timeout"`
			} `json:"transport" pconf:"transport"`
		} `json:"node" pconf:"node"`
	} `json:"peers" pconf:"peers"`
}

func (c *TransportConfig) Options() []option.Option {
	var opts []option.Option

	if len(c.Peers.Node.Transport.Addrs) > 0 {
		opts = append(opts, transport.Addrs(c.Peers.Node.Transport.Addrs...))
	}

	opts = append(opts, transport.Secure(c.Peers.Node.Transport.Secure))

	if len(c.Peers.Node.Transport.Timeout) > 0 {
		opts = append(opts, transport.Timeout(c.Peers.Node.Transport.Timeout))
	}

	if c.Peers.Node.Transport.Native.EnableRelay {
		opts = append(opts, EnableRelay())
	}

	if len(c.Peers.Node.Transport.Native.Libp2pIdentityKeyFile) > 0 {
		opts = append(opts, WithLibp2pIdentityKeyFile(c.Peers.Node.Transport.Native.Libp2pIdentityKeyFile))
	}

	return opts
}

type nativeTransportPlugin struct{}

func (p *nativeTransportPlugin) Name() string {
	return plugin.NativePluginName
}

func (p *nativeTransportPlugin) Options() []option.Option {
	return transportConfig.Options()
}

func (p *nativeTransportPlugin) New(opts ...option.Option) transport.Transport {
	return NewTransport(append(p.Options(), opts...)...)
}

func init() {
	config.RegisterOptions(&transportConfig)
	plugin.TransportPlugins[plugin.NativePluginName] = &nativeTransportPlugin{}
}
