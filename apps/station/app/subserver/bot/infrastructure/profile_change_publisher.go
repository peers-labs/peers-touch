package infrastructure

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/registry"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

// ProfileChangePublisher adapts the process EventBus to the registry
// application port. The wake targets the owning human's actor stream while
// the event subject is the bot actor, so owner devices invalidate the bot
// profile cache.
type ProfileChangePublisher struct{}

// NewProfileChangePublisher constructs the realtime publisher for bot profile
// mutations.
func NewProfileChangePublisher() *ProfileChangePublisher { return &ProfileChangePublisher{} }

// PublishActorProfileChanged emits the actor_profile_changed arm after a bot
// avatar/profile commit. A missing bus (events subserver not initialized) is a
// no-op: the periodic client reconcile remains the fallback. Publish errors
// are logged, not propagated, because the profile row is already durable truth.
func (ProfileChangePublisher) PublishActorProfileChanged(
	ctx context.Context,
	wake registry.ProfileChangeWake,
) error {
	if wake.OwnerPtid == "" || wake.BotPtid == "" {
		return fmt.Errorf("bot profile change publish: owner and bot ptid are required")
	}
	bus := events.GetBus()
	if bus == nil {
		log.Warnf(ctx, "bot profile change publish: event bus unavailable, skipping owner=%s bot=%s",
			wake.OwnerPtid, wake.BotPtid)
		return nil
	}
	if _, err := bus.Publish(wake.OwnerPtid, &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_ActorProfileChanged{
			ActorProfileChanged: &realtime.ActorProfileChanged{
				ActorPtid:       wake.BotPtid,
				ChangedTsUnixMs: wake.ChangedAtUnixMs,
			},
		},
	}); err != nil {
		log.Warnf(ctx, "bot profile change publish failed owner=%s bot=%s: %v",
			wake.OwnerPtid, wake.BotPtid, err)
	}
	return nil
}
