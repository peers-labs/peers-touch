package oss

import (
	"context"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

var ossOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Oss struct {
						Enabled    bool   `pconf:"enabled"`
						Path       string `pconf:"path"`
						DBName     string `pconf:"rds-name"`
						StorePath  string `pconf:"store-path"`
						Token      string `pconf:"token"`
						SignSecret string `pconf:"sign-secret"`
					} `pconf:"oss"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type ossPlugin struct{}

func (p *ossPlugin) Name() string { return "oss" }
func (p *ossPlugin) Options() []option.Option {
	return []option.Option{
		WithPath(ossOptions.Peers.Node.Server.Subserver.Oss.Path),
		WithDBName(ossOptions.Peers.Node.Server.Subserver.Oss.DBName),
		WithStorePath(ossOptions.Peers.Node.Server.Subserver.Oss.StorePath),
		WithToken(ossOptions.Peers.Node.Server.Subserver.Oss.Token),
		WithSignSecret(ossOptions.Peers.Node.Server.Subserver.Oss.SignSecret),
	}
}
func (p *ossPlugin) Enabled() bool { return ossOptions.Peers.Node.Server.Subserver.Oss.Enabled }
func (p *ossPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewOSSSubServer(opts...)
}

func init() {
	config.RegisterOptions(&ossOptions)
	// ensure our table migrates when store initializes
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		_ = rds.AutoMigrate(&ossmodel.FileMeta{})
	})
	plugin.SubserverPlugins["oss"] = &ossPlugin{}
}
