package a

import (
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
)

type nativeBrokerPlugin struct{}

func (p *nativeBrokerPlugin) Name() string                            { return plugin.NativePluginName }
func (p *nativeBrokerPlugin) Options() []option.Option                { return nil }
func (p *nativeBrokerPlugin) New(opts ...option.Option) broker.Broker { return New() }

func init() {
	plugin.BrokerPlugins[(&nativeBrokerPlugin{}).Name()] = &nativeBrokerPlugin{}
	// Register named instance and set as default for first version
	b := New()
	broker.Register("a", b)
	broker.SetDefault(b)
}
