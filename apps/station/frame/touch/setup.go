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

// Development preset seeding is intentionally not exposed over HTTP/RPC: it
// can only run from this startup hook, and only when peers.actor.dev_seed_enabled
// is explicitly turned on (off by default). There is deliberately no
// process-local "run once" gate — that would reset on restart and give a false
// guarantee. Cross-restart idempotency is owned by the database-level checks in
// the seed functions (existing actor / friendship / federation lookups), so a
// restart with seeding enabled is a no-op once data exists.
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
	if !GetDevSeedEnabled() {
		return nil
	}
	seedDevPresets(ctx)
	return nil
}

func seedDevPresets(ctx context.Context) {
	presets := GetPresetUsers()
	if len(presets) == 0 {
		return
	}
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

	// Auto-friend the first 3 preset users (alice, bob, carol) as a fully
	// connected group.
	if len(presets) >= 3 {
		devFriends := make([]string, 3)
		for i := 0; i < 3; i++ {
			devFriends[i] = presets[i].Username
		}
		if err := actor.SeedDevFriendships(ctx, devFriends); err != nil {
			log.Warnf(ctx, "seed dev friendships: %v", err)
		}
	}

	// dave is a fourth preset actor who is friends with bob and carol but
	// NOT alice, so the seeded mixed group contains a stranger from
	// alice's view. Pairing the subset seeds only the missing dave edges;
	// the bob<->carol edge already exists from the first friendship seed.
	daveFriends := make([]string, 0, 3)
	for _, p := range presets {
		if p.Username == "bob" || p.Username == "carol" || p.Username == "dave" {
			daveFriends = append(daveFriends, p.Username)
		}
	}
	if len(daveFriends) == 3 {
		if err := actor.SeedDevFriendships(ctx, daveFriends); err != nil {
			log.Warnf(ctx, "seed dave friendships: %v", err)
		}
	}
}
