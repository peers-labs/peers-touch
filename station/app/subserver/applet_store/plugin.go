package applet_store

import (
    "github.com/peers-labs/peers-touch/station/frame/core/config"
    "github.com/peers-labs/peers-touch/station/frame/core/option"
    "github.com/peers-labs/peers-touch/station/frame/core/plugin"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
)

var storeOptions struct{
    Peers struct{
        Node struct{
            Server struct{
                Subserver struct{
                    AppletStore struct{
                        Enabled bool   `pconf:"enabled"`
                        Path    string `pconf:"path"`
                        DBName  string `pconf:"db-name"`
                        StorePath string `pconf:"store-path"`
                    } `pconf:"applet-store"`
                } `pconf:"subserver"`
            } `pconf:"server"`
        } `pconf:"node"`
    } `pconf:"peers"`
}

type storePlugin struct{}

func (p *storePlugin) Name() string { return "applet-store" }
func (p *storePlugin) Options() []option.Option {
    return []option.Option{
        WithPathBase(storeOptions.Peers.Node.Server.Subserver.AppletStore.Path),
        WithDBName(storeOptions.Peers.Node.Server.Subserver.AppletStore.DBName),
        WithStorePath(storeOptions.Peers.Node.Server.Subserver.AppletStore.StorePath),
    }
}
func (p *storePlugin) Enabled() bool { return storeOptions.Peers.Node.Server.Subserver.AppletStore.Enabled }
func (p *storePlugin) New(opts ...option.Option) server.Subserver {
    opts = append(opts, p.Options()...)
    return NewAppletStoreSubServer(opts...)
}

func init(){
    config.RegisterOptions(&storeOptions)
    plugin.SubserverPlugins["applet-store"] = &storePlugin{}
}

