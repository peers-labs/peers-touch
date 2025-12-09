package oauth

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var oauthOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					OAuth struct {
						Enabled bool `pconf:"enabled"`
					} `pconf:"oauth"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type oauthPlugin struct{}

func (p *oauthPlugin) Name() string                               { return "oauth" }
func (p *oauthPlugin) Options() []option.Option                   { return nil }
func (p *oauthPlugin) Enabled() bool                              { return oauthOptions.Peers.Node.Server.Subserver.OAuth.Enabled }
func (p *oauthPlugin) New(opts ...option.Option) server.Subserver { return NewOAuthSubServer(opts...) }

func init() {
	config.RegisterOptions(&oauthOptions)
	plugin.SubserverPlugins["oauth"] = &oauthPlugin{}
}
