package registry

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

// Repository is the persistence port for the bot registry. Implemented by
// infrastructure/persistence; the application layer never touches gorm.
type Repository interface {
	Create(ctx context.Context, b *domain.Bot) error
	Update(ctx context.Context, b *domain.Bot) error
	GetByPtid(ctx context.Context, botPtid string) (*domain.Bot, error)
	GetByWebhookID(ctx context.Context, webhookID string) (*domain.Bot, error)
	ListByOwner(ctx context.Context, ownerPtid string) ([]*domain.Bot, error)
	ActiveByName(ctx context.Context, ownerPtid, name string) (*domain.Bot, error)
}

// ActorMinter provisions the non-human AGENT actor (PTID letter "b", HIDDEN)
// inside the Station and returns its PTID. The bot sub-server does not own
// actor persistence; the actor frame package implements this port.
type ActorMinter interface {
	MintAgentActor(ctx context.Context, handle, displayName, namespace string) (botPtid string, err error)
	// SetAgentAvatar sets the bot actor's icon (Station-relative OSS URL;
	// empty clears it) without any federation publish.
	SetAgentAvatar(ctx context.Context, botPtid, avatarURL string) error
}

// ProfileChangeWake describes a committed bot actor profile mutation that the
// owning human's live devices should observe immediately. The wake is fanned
// out to the owner's actor stream while carrying the bot PTID as the changed
// subject, so clients invalidate the bot (not the owner) profile cache.
type ProfileChangeWake struct {
	OwnerPtid       string
	BotPtid         string
	ChangedAtUnixMs int64
}

// ProfileChangePublisher emits the post-commit actor_profile_changed realtime
// wake onto the owner's device streams. It is implemented by infrastructure
// over the process EventBus; the application layer treats it as a best-effort
// projection (the actor row is already durable truth).
type ProfileChangePublisher interface {
	PublishActorProfileChanged(ctx context.Context, wake ProfileChangeWake) error
}
