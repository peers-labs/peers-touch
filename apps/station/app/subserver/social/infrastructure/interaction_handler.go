package infrastructure

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// InteractionInput carries the shared projection context resolved by the
// FeedProjector kernel (target, locks, parent post) before dispatching to a
// concrete interaction handler. Handlers own only their variant's write
// logic; the kernel keeps savepoint/lock/fanout orchestration.
type InteractionInput struct {
	Tx      *gorm.DB
	Receipt *model.FeedInteraction
	Payload *model.FeedPayload
	Post    *db.SocialPublicPost
	Home    string
	Target  string
}

// InteractionHandler projects exactly one FeedPayload mutation variant
// (reaction / comment / poll ballot). The projector resolves a handler from
// its registry instead of a closed type switch, so removing a variant only
// deletes its handler and registration.
type InteractionHandler interface {
	// Match reports whether this handler serves payload's mutation.
	Match(payload *model.FeedPayload) bool
	Project(ctx context.Context, in InteractionInput) error
}

// InteractionRegistry is an immutable dispatch table built at wiring time.
// Every payload must match exactly one handler; ambiguity and unmatched
// variants fail explicitly rather than being silently dropped.
type InteractionRegistry struct {
	handlers []InteractionHandler
}

func NewInteractionRegistry(handlers ...InteractionHandler) (*InteractionRegistry, error) {
	if len(handlers) == 0 {
		return nil, fmt.Errorf("interaction registry requires at least one handler")
	}
	seen := make(map[string]struct{}, len(handlers))
	for _, h := range handlers {
		if h == nil {
			return nil, fmt.Errorf("nil interaction handler")
		}
		key := fmt.Sprintf("%T", h)
		if _, dup := seen[key]; dup {
			return nil, fmt.Errorf("duplicate interaction handler %s", key)
		}
		seen[key] = struct{}{}
	}
	return &InteractionRegistry{handlers: handlers}, nil
}

// Resolve returns the unique handler matching payload or an error when zero
// or multiple handlers claim it.
func (r *InteractionRegistry) Resolve(payload *model.FeedPayload) (InteractionHandler, error) {
	var matched InteractionHandler
	for _, h := range r.handlers {
		if !h.Match(payload) {
			continue
		}
		if matched != nil {
			return nil, fmt.Errorf("ambiguous interaction payload: %T and %T", matched, h)
		}
		matched = h
	}
	if matched == nil {
		return nil, fmt.Errorf("no interaction handler for payload")
	}
	return matched, nil
}
