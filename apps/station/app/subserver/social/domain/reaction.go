package domain

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// Reaction is one typed reaction by one actor on one post. The composite
// natural key `(PostID, ActorID, Kind)` enforces "at most one of each
// kind per (actor, post)" — the same actor can LIKE *and* LOVE the same
// post but cannot LIKE it twice. Toggling a reaction on/off is therefore
// a clean Insert/Delete on the same key.
//
// Visibility is inherited from the parent post (architecture invariant
// 9); the ReactionService gates writes via `CanReact` which is just
// `CanRead` with extra anti-bot checks deferred to a future phase.
type Reaction struct {
	PostID    uint64
	PostClass PostClass

	ActorID uint64

	// Kind matches the `model.ReactionKind` proto enum. Stored on the DB
	// side as `varchar(16)` containing the proto enum's String() form
	// (e.g. "REACTION_LIKE") so admin queries are human-readable and the
	// table is forward-compatible if new reaction kinds are added.
	Kind model.ReactionKind

	CreatedAt time.Time
}

// ReactionSummary is a per-kind aggregation for a single post. The
// application layer hydrates the list before returning a Post to the
// client; `ReactedByViewer` is only meaningful when `viewerID != 0`.
type ReactionSummary struct {
	Kind            model.ReactionKind
	Count           int64
	ReactedByViewer bool
}
