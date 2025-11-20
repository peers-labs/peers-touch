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
		Transport struct {
			Name    string   `json:"name" pconf:"name"`
			Addrs   []string `json:"addrs" pconf:"addrs"`
			Secure  bool     `json:"secure" pconf:"secure"`
			Timeout string   `json:"timeout" pconf:"timeout"`
		} `json:"transport" pconf:"transport"`
	} `json:"peers" pconf:"peers"`
}

func (c *TransportConfig) Options() []option.Option {
	var opts []option.Option

	if len(c.Peers.Transport.Addrs) > 0 {
		opts = append(opts, transport.Addrs(c.Peers.Transport.Addrs...))
	}

	opts = append(opts, transport.Secure(c.Peers.Transport.Secure))

	if len(c.Peers.Transport.Timeout) > 0 {
		opts = append(opts, transport.Timeout(c.Peers.Transport.Timeout))
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
	return NewTransport()
}

func init() {
	config.RegisterOptions(&transportConfig)
	plugin.TransportPlugins[plugin.NativePluginName] = &nativeTransportPlugin{}
}
