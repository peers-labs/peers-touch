package infrastructure

import (
	"context"

	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

// ActorMinter adapts the actor frame's internal AGENT mint to the registry
// application port.
type ActorMinter struct{}

func NewActorMinter() *ActorMinter { return &ActorMinter{} }

func (ActorMinter) MintAgentActor(ctx context.Context, handle, displayName, namespace string) (string, error) {
	return touchactor.MintInternalAgentActor(ctx, handle, displayName, namespace)
}

// SetAgentAvatar writes the bot AGENT actor's icon without any federation
// publish (bots are HIDDEN and never log in).
func (ActorMinter) SetAgentAvatar(ctx context.Context, botPtid, avatarURL string) error {
	return touchactor.SetInternalAgentAvatar(ctx, botPtid, avatarURL)
}
