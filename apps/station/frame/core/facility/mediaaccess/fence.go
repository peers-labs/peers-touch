// Package mediaaccess defines the synchronous cross-owner revocation port.
// It owns no membership, device, session, grant, or media persistence.
package mediaaccess

import (
	"context"
	"sync"
)

type Endpoint struct {
	ActorPTID string
	DeviceID  string
	Home      string
}

type ConversationScope struct {
	ConversationID string
	Authority      string
	Epoch          uint64
	Active         bool
	Endpoints      []Endpoint
}

// Fence runs while the original permission owner's transaction remains locked.
// Failure prevents that owner's permission mutation from committing.
type Fence interface {
	RevokeDevice(context.Context, string, string) error
	RevokeSessions(context.Context, []string) error
	ReconcileConversation(context.Context, ConversationScope) error
}

var registry struct {
	sync.RWMutex
	fence Fence
}

// Register binds the group media owner during Station initialization.
func Register(fence Fence) {
	registry.Lock()
	defer registry.Unlock()
	registry.fence = fence
}

func current() Fence {
	registry.RLock()
	defer registry.RUnlock()
	return registry.fence
}

func RevokeDevice(ctx context.Context, ptid, deviceID string) error {
	if fence := current(); fence != nil {
		return fence.RevokeDevice(ctx, ptid, deviceID)
	}
	return nil
}

func RevokeSessions(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if fence := current(); fence != nil {
		return fence.RevokeSessions(ctx, ids)
	}
	return nil
}

func ReconcileConversation(ctx context.Context, scope ConversationScope) error {
	if fence := current(); fence != nil {
		return fence.ReconcileConversation(ctx, scope)
	}
	return nil
}
