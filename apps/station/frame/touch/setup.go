package touch

import (
	"context"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"gorm.io/gorm"
)

func Lifecycle() []option.Option {
	return []option.Option{
		node.BeforeInit(func(sOpts *node.Options) error {
			store.InitTableHooks(onStoreReady)
			return nil
		}),
		node.AfterStart(onAfterStart),
	}
}

func onStoreReady(ctx context.Context, rds *gorm.DB) {
	auth.InitSessionManager(ctx)
}

func onAfterStart() error {
	ctx := context.Background()
	presets := GetPresetUsers()
	if len(presets) > 0 {
		configs := make([]actor.PresetActorConfig, len(presets))
		for i, p := range presets {
			configs[i] = actor.PresetActorConfig{
				Username:    p.Username,
				Email:       p.Email,
				Password:    p.Password,
				DisplayName: p.DisplayName,
				Endpoints:   p.Endpoints,
			}
		}
		if err := actor.SeedPresetActors(ctx, configs); err != nil {
			log.Warnf(ctx, "seed preset actors: %v", err)
		}
	}
	return nil
}
