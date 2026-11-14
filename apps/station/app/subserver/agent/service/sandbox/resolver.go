package sandbox

import "context"

// Resolver is the read-only allocation view used to choose where a
// WORKSPACE_SANDBOX terminal attaches. It reads the allocation table only: it
// never allocates, cold-starts, releases, or contacts the provisioner, so it
// cannot violate the rule that Station mode only opens explicitly-allocated
// sandboxes.
type Resolver struct {
	store Store
}

func NewResolver(store Store) *Resolver {
	return &Resolver{store: store}
}

// ActiveForActor lists the actor's non-released sandboxes
// (REQUESTED/ALLOCATED/DORMANT), oldest allocation first. The caller decides
// which are usable for a terminal; Resolver itself performs no side effects.
func (r *Resolver) ActiveForActor(ctx context.Context, actorPTID string) ([]*Sandbox, error) {
	return r.store.ListActiveForActor(ctx, actorPTID)
}
