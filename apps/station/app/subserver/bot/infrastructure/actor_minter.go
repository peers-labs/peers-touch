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
