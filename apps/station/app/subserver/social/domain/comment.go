package domain

import "time"

// PostClass identifies which physical post table a comment / reaction
// belongs to. Stored alongside `PostID` so the application layer can
// route hydration to the correct post repo without a double-join.
//
// Mirrors the `db.PostClassPublic` / `db.PostClassPrivate` constants;
// kept here as a domain-level type so repositories' interface signatures
// don't have to reach into the DB package.
type PostClass string

const (
	PostClassPublic  PostClass = "public"
	PostClassPrivate PostClass = "private"
)

// Comment is a single-level threaded comment on a Moment. v1 enforces at
// most one level of nesting:
//
//   - a top-level comment has `ParentCommentID == 0`
//   - a reply has `ParentCommentID != 0`, and that parent's
//     ParentCommentID MUST itself be 0 (enforced in CommentService)
//
// Visibility is implicitly inherited from the parent post (architecture
// invariant 9: a comment is visible iff its parent post is visible to
// the viewer); there is no per-comment audience.
type Comment struct {
	ID        uint64
	PostID    uint64
	PostClass PostClass

	AuthorID uint64

	// ParentCommentID == 0 means top-level. Stored as plain uint64 here
	// (rather than *uint64 like the DB struct) for ergonomics; converters
	// translate to/from the nullable DB column.
	ParentCommentID uint64

	TextBody     string
	MentionsJSON string

	EditedAt  *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

// IsTopLevel reports whether this is a direct comment on a post (vs a
// reply to another comment). Used by CommentService to enforce the
// "at most one level of nesting" rule.
func (c *Comment) IsTopLevel() bool { return c.ParentCommentID == 0 }
