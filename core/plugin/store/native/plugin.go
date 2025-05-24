package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

var options struct {
	Peers struct {
		Store struct {
			Name   string `pconf:"name"`
			Native struct {
				RDS struct {
					GORM []struct {
						Name   string `pconf:"name"`
						Enable bool   `pconf:"enable"`
						DSN    string `pconf:"dsn"`
					} `pconf:"gorm"`
				} `pconf:"rds"`
			} `pconf:"native"`
		} `pconf:"store"`
	} `pconf:"peers"`
}

type nativeStorePlugin struct {
}

func (n *nativeStorePlugin) Name() string {
	return plugin.NativePluginName
}

func (n *nativeStorePlugin) Options() []option.Option {
	var opts []option.Option
	if len(options.Peers.Store.Native.RDS.GORM) > 0 {
		for _, g := range options.Peers.Store.Native.RDS.GORM {
			opts = append(opts, store.WithRDS(&store.RDSInit{Name: g.Name, Enable: g.Enable, DSN: g.DSN}))
		}
	}

	return opts
}

func (n *nativeStorePlugin) New(opts ...option.Option) store.Store {
	opts = append(opts, n.Options()...)
	return NewStore(opts...)
}

func init() {
	config.RegisterOptions(&options)
	p := &nativeStorePlugin{}
	plugin.StorePlugins[p.Name()] = p
}
