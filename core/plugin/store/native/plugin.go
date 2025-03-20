package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

var options struct {
	Peers struct {
		Service struct {
			Store struct {
				Native struct {
					Enabled bool `pconf:"enabled"`
				} `pconf:"native"`
			} `pconf:"store"`
		} `pconf:"service"`
	} `pconf:"peers"`
}

type nativeStorePlugin struct {
}

func (n *nativeStorePlugin) Name() string {
	return "native"
}

func (n *nativeStorePlugin) Options() []option.Option {
	var opts []option.Option
	if options.Peers.Service.Store.Native.Enabled {
		// todo append opts
	}

	return opts
}

func (n *nativeStorePlugin) New(opts ...option.Option) store.Store {
	opts = append(opts, n.Options()...)
	return NewStore(opts...)
}

func init() {
	config.RegisterOptions(&options)
	plugin.StorePlugins["native"] = &nativeStorePlugin{}
}
