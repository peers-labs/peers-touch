package domain

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// Post is the domain-layer representation of a Moment. It is intentionally
// thin and storage-agnostic — repositories translate between this struct
// and the two physical tables `social_public_posts` / `social_private_posts`
// (see `docs/architecture/domains/social/core/moments.md §6.2`); the application layer
// (MomentService) owns the business rules and routes Posts to the correct
// repo via `IsPublic`.
//
// Content payloads (text, attachments, mentions, link preview) are kept as
// opaque JSON-encoded strings here. The domain layer does not need to
// interpret them — visibility / authorisation decisions are made entirely
// from `Audience`. The application layer marshals proto bodies into these
// columns on write, and unmarshals them on read into the appropriate proto
// `oneof` content variant.
type Post struct {
	ID         uint64
	AuthorPTID string

	// Type matches `model.PostType` (TEXT / IMAGE / VIDEO / LINK / POLL /
	// REPOST / LOCATION). Stored as the proto enum's String() form on the
	// DB side — varchar(20) — so admin queries are readable.
	Type model.PostType

	// Audience is the publish-time visibility decision. MUST be non-nil
	// for any newly-created post (legacy posts predating Moments stored a
	// nil audience and are treated as PUBLIC by `CanRead`).
	Audience *model.Audience

	// Opaque JSON payloads. The schema of each is determined by `Type`
	// per the `Post.content` proto oneof; see converter for the
	// authoritative mapping.
	TextBody        string
	AttachmentsJSON string
	MentionsJSON    string
	LinkPreviewJSON string

	// RepostOfRef is set when `Type == REPOST`. The architecture uses
	// `oss://{station}/post/{id}` for cross-station refs; same-station
	// reposts may store the bare numeric id. Empty for non-reposts.
	RepostOfRef string

	// ReactionsCountJSON is a denormalized snapshot — `{"LIKE":3,
	// "LOVE":1}` keyed by `model.ReactionKind` String() form. The source
	// of truth lives in `social_reactions`; this column exists so list
	// queries can hydrate a Post without an N+1 reaction lookup. The
	// ReactionService is responsible for keeping it in sync.
	ReactionsCountJSON string

	CommentsCount int64
	ViewsCount    int64

	EditedAt  *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time

	// DeletedAt non-nil marks the post as soft-deleted. CanRead returns
	// false for deleted posts — including to the author.
	DeletedAt *time.Time
}

// IsPublic dispatches to the audience-level helper; defined here as a
// method for ergonomic call sites in repositories' invariant checks.
//
//	if !post.IsPublic() { panic("public repo only accepts PUBLIC posts") }
func (p *Post) IsPublic() bool { return IsPublic(p.Audience) }

// IsDeleted is a stable shorthand for `p.DeletedAt != nil`. Provided so
// CanRead callers don't need to read the timestamp field directly when
// the only thing that matters is "is it tombstoned".
func (p *Post) IsDeleted() bool { return p.DeletedAt != nil }
