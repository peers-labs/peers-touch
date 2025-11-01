package native

import (
	"github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
)

var options struct {
	Peers struct {
		Store struct {
			RDS struct {
				GORM []struct {
					Name    string `pconf:"name"`
					Default bool   `pconf:"default"`
					Enable  bool   `pconf:"enable"`
					DSN     string `pconf:"dsn"`
				} `pconf:"gorm"`
			} `pconf:"rds"`
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

	defaultDeclared := false
	only1Rds := len(options.Peers.Store.RDS.GORM) == 1
	for _, g := range options.Peers.Store.RDS.GORM {
		if g.Default && !defaultDeclared || only1Rds {
			defaultDeclared = true
		}

		opts = append(opts, store.WithRDS(&store.RDSInit{Name: g.Name, Default: g.Default || only1Rds, Enable: g.Enable, DSN: g.DSN}))
	}

	if !defaultDeclared {
		panic("no default rds")
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
