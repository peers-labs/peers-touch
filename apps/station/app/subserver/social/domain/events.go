package domain

import "time"

// Domain events emitted by the social subserver. P1 defines the shapes
// only — the in-process broker / cross-subserver bridge wiring lands in
// P3 (the moments architecture doc §13 ties this to the `events`
// subserver and `notification.Bridge`). Until then the application layer
// constructs these structs and logs them at INFO so reviewers can verify
// the call sites are correct, then drops them on the floor.
//
// Keeping these in `domain` (instead of an `events` subdirectory) avoids
// a circular import: services use them at the boundaries between
// application → infra → external; defining the shapes alongside the
// aggregates they describe keeps the dependency graph one-way.

// MomentCreated fires after a Moment is successfully persisted — both
// public and private flows publish it. Subscribers include:
//   - notification.Bridge (mention notifications, reply notifications)
//   - events broker (SSE/WebSocket push to followers in the audience)
//   - outbox dispatcher (P3+, ActivityPub fan-out for IsPublic posts)
type MomentCreated struct {
	PostID      uint64
	AuthorID    uint64
	IsPublic    bool
	AudienceTag string // e.g. "PUBLIC" / "FOLLOWERS" / "CIRCLE:42"
	MentionedDIDs []string
	CreatedAt   time.Time
}

// MomentDeleted fires after a soft-delete (DeletedAt set). Comments,
// reactions, audience grants, and outbox entries for the post should
// all be cascaded by the publishers/subscribers — the social subserver
// does the local cascade in the same transaction; cross-subserver
// listeners (notification, federation outbox) cascade lazily on receive.
type MomentDeleted struct {
	PostID    uint64
	AuthorID  uint64
	IsPublic  bool
	DeletedAt time.Time
}

// Reacted fires when an actor adds a reaction. Toggling-off (Unreact)
// fires a Reacted event with `Removed: true`.
type Reacted struct {
	PostID    uint64
	PostAuthorID uint64
	ActorID   uint64
	Kind      string // ReactionKind String() form
	Removed   bool
	At        time.Time
}

// Commented fires when a top-level comment or 1-level reply is created.
// `ParentCommentID == 0` for top-level.
type Commented struct {
	PostID          uint64
	PostAuthorID    uint64
	CommentID       uint64
	CommentAuthorID uint64
	ParentCommentID uint64
	MentionedDIDs   []string
	At              time.Time
}
