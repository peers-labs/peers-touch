package touch

import (
	"context"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	promInit "github.com/peers-labs/peers-touch/station/frame/core/metrics/prometheus"
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
		node.AfterStart(func() error {
			promInit.TryStartRemoteWrite(context.Background())
			return nil
		}),
	}
}

func onStoreReady(ctx context.Context, rds *gorm.DB) {
	auth.InitSessionManager(ctx)
	// Actor online/offline is derived from heartbeats. Ensure the watchdog runs so
	// stale online states are eventually marked offline even if clients crash.
	actor.InitStatusManager(ctx)
}

func onAfterStart() error {
	ctx := context.Background()
	presets := GetPresetUsers()
	if len(presets) > 0 {
		configs := make([]actor.PresetActorConfig, len(presets))
		for i, p := range presets {
			configs[i] = actor.PresetActorConfig{
				Username:      p.Username,
				Email:         p.Email,
				Password:      p.Password,
				DisplayName:   p.DisplayName,
				Avatar:        p.Avatar,
				LegacyAvatars: p.LegacyAvatars,
				Endpoints:     p.Endpoints,
			}
		}
		if err := actor.SeedPresetActors(ctx, configs); err != nil {
			log.Warnf(ctx, "seed preset actors: %v", err)
		}

		// Auto-friend the first 3 preset users (alice, bob, carol).
		if len(presets) >= 3 {
			devFriends := make([]string, 3)
			for i := 0; i < 3; i++ {
				devFriends[i] = presets[i].Username
			}
			if err := actor.SeedDevFriendships(ctx, devFriends); err != nil {
				log.Warnf(ctx, "seed dev friendships: %v", err)
			}
		}

		if err := actor.SeedDevFederation(ctx, presets[0].Username); err != nil {
			log.Warnf(ctx, "seed dev federation: %v", err)
		}
	}
	return nil
}
