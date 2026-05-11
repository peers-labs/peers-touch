package domain

import (
	"context"
	"time"
)

// PublicPostRepository accesses `social_public_posts` exclusively. Its
// signatures take no `viewerID` because public posts are visible to
// everyone — including anonymous viewers and (post-v1) federated outbound
// fan-out. The implementation MUST panic if `Create` is called with a
// non-PUBLIC post; this is the first of the three defense lines (see
// `docs/architecture/social/moments.md §8`).
type PublicPostRepository interface {
	Create(ctx context.Context, p *Post) error
	GetByID(ctx context.Context, id uint64) (*Post, error)
	Delete(ctx context.Context, id, authorID uint64) error

	ListByAuthor(ctx context.Context, authorID uint64, c Cursor, limit int) ([]*Post, error)
	ListPublic(ctx context.Context, c Cursor, limit int) ([]*Post, error)

	// ListPublicByAuthors returns the most recent public posts authored
	// by any of `authorIDs`. Used to feed the "public-followed" stream of
	// the HOME multi-source merge. Empty `authorIDs` → empty result.
	ListPublicByAuthors(ctx context.Context, authorIDs []uint64, c Cursor, limit int) ([]*Post, error)

	// ListPublicHot returns public posts ranked by an engagement-decayed
	// score (newer + more interactions ranks higher), with a tie-break
	// on (created_at DESC, id DESC) so cursor pagination is stable.
	// Implementations should return rows whose (score, created_at, id)
	// is strictly less than the cursor's, treating the zero cursor as
	// "from the top".
	//
	// The score formula is intentionally simple — see the
	// implementation for the exact SQL — and lives entirely in the
	// repository layer because it's a database-side concern. The
	// application layer only chooses RECENT vs HOT.
	ListPublicHot(ctx context.Context, c HotCursor, limit int) ([]*Post, error)

	// UpdateCommentsCount applies a relative delta to the denormalized
	// `comments_count` column. Returns the new count. Negative deltas
	// must not push the counter below zero (implementations clamp).
	UpdateCommentsCount(ctx context.Context, id uint64, delta int64) (int64, error)

	// UpdateReactionsCount overwrites the `reactions_count_json` snapshot
	// computed by ReactionService.
	UpdateReactionsCount(ctx context.Context, id uint64, snapshotJSON string) error
}

// PrivatePostRepository accesses `social_private_posts` and the
// `social_private_audience_grants` join table. Every read path REQUIRES
// `viewerID` so the type system itself prevents an "I forgot the
// permission filter" bug — the second defense line. The implementation
// MUST panic if `Create` is called with a PUBLIC post.
//
// Audiences other than FOLLOWERS / SELF / CIRCLE / GROUP / CUSTOM_* are
// physically impossible to land here because the repo enforces
// `audience_kind != 'PUBLIC'` at insert.
type PrivatePostRepository interface {
	Create(ctx context.Context, p *Post) error
	GetByID(ctx context.Context, id, viewerID uint64) (*Post, error)
	Delete(ctx context.Context, id, authorID uint64) error

	// ListByFollowingForViewer returns private posts authored by any of
	// `followedAuthorIDs` whose audience is FOLLOWERS (the only private
	// kind broadcast to followers as a class). Posts targeting CIRCLE /
	// GROUP / CUSTOM_* are intentionally excluded — those are served by
	// the dedicated list methods below.
	ListByFollowingForViewer(ctx context.Context, viewerID uint64, followedAuthorIDs []uint64, c Cursor, limit int) ([]*Post, error)

	// ListSelfByAuthor returns the viewer's own SELF-audience posts.
	// Distinct from `ListByAuthorVisibleTo` because SELF posts are only
	// readable by the author and never appear in any other viewer's feed.
	ListSelfByAuthor(ctx context.Context, authorID uint64, c Cursor, limit int) ([]*Post, error)

	// ListByCircleForViewer returns posts whose audience is
	// CIRCLE-targeting `circleID`, accessible to the viewer iff the
	// viewer is a member of the circle. Membership is asserted by the
	// application layer before calling this method; the repo trusts the
	// caller (defense in depth: the third line `CanRead` re-checks).
	ListByCircleForViewer(ctx context.Context, viewerID, circleID uint64, c Cursor, limit int) ([]*Post, error)

	// ListByCirclesForViewer is the multi-circle variant used by the HOME
	// merge — pass all circles the viewer is a member of.
	ListByCirclesForViewer(ctx context.Context, viewerID uint64, circleIDs []uint64, c Cursor, limit int) ([]*Post, error)

	// ListByGroupForViewer / ListByGroupsForViewer mirror the Circle
	// variants; group membership is resolved via `GroupMembershipChecker`.
	ListByGroupForViewer(ctx context.Context, viewerID, groupID uint64, c Cursor, limit int) ([]*Post, error)
	ListByGroupsForViewer(ctx context.Context, viewerID uint64, groupIDs []uint64, c Cursor, limit int) ([]*Post, error)

	// ListByAuthorVisibleTo returns posts authored by `authorID` that
	// `viewerID` is allowed to see — used when rendering "someone else's
	// profile". Implementations apply a server-side filter equivalent to
	// `CanRead` for FOLLOWERS / CIRCLE / GROUP audiences; CUSTOM_* are
	// resolved via the grants table; SELF posts are excluded unless
	// `viewerID == authorID`.
	ListByAuthorVisibleTo(ctx context.Context, authorID, viewerID uint64, c Cursor, limit int) ([]*Post, error)

	UpdateCommentsCount(ctx context.Context, id uint64, delta int64) (int64, error)
	UpdateReactionsCount(ctx context.Context, id uint64, snapshotJSON string) error
}

// AudienceGrant is the domain-level twin of `db.SocialPrivateAudienceGrant`,
// representing one entry on a CUSTOM_ALLOW or CUSTOM_DENY post's actor
// list.
type AudienceGrant struct {
	PostID   uint64
	ActorDID string
	Role     GrantRole
}

// GrantRole mirrors the DB column. Stored as the constants below; the
// application layer never invents new roles, so a string-typed enum is
// fine.
type GrantRole string

const (
	GrantRoleAllow GrantRole = "allow"
	GrantRoleDeny  GrantRole = "deny"
)

// AudienceGrantRepository persists CUSTOM_ALLOW / CUSTOM_DENY actor lists.
// Lifecycle is bound to the parent post: `MomentService.Create` writes the
// grant rows in the same transaction as the post; `MomentService.Delete`
// removes them in the same transaction as the post tombstone.
type AudienceGrantRepository interface {
	AddGrants(ctx context.Context, postID uint64, grants []AudienceGrant) error
	ListGrants(ctx context.Context, postID uint64) ([]AudienceGrant, error)
	DeleteGrants(ctx context.Context, postID uint64) error

	// HasDenyGrant is the SQL-fast-path used by `PrivatePostRepository.
	// GetByID` to short-circuit "viewer is on a CUSTOM_DENY list" before
	// returning a row. Returns true iff `(postID, actorDID, 'deny')` is
	// present.
	HasDenyGrant(ctx context.Context, postID uint64, actorDID string) (bool, error)
}

type MomentDelivery struct {
	ID           uint64
	ViewerID     uint64
	PostID       uint64
	AuthorID     uint64
	AudienceKind string
	DeliveredAt  time.Time
	RevokedAt    *time.Time
}

// MomentDeliveryRepository persists viewer-scoped HOME inbox rows for
// private Moments. It is the durable counterpart to realtime fan-out.
type MomentDeliveryRepository interface {
	Upsert(ctx context.Context, deliveries []MomentDelivery) error
	ListInbox(ctx context.Context, viewerID uint64, c Cursor, limit int) ([]MomentDelivery, error)
	RevokePost(ctx context.Context, postID uint64) error
}

// CommentRepository persists `social_comments`. Comments are stored in a
// single table for both post classes (with `PostClass` denormalized) so
// cursor pagination doesn't need a UNION across two tables.
type CommentRepository interface {
	Create(ctx context.Context, c *Comment) error
	GetByID(ctx context.Context, id uint64) (*Comment, error)
	Delete(ctx context.Context, id, authorID uint64) error
	ListByPost(ctx context.Context, postID uint64, c Cursor, limit int) ([]*Comment, error)
	CountByPost(ctx context.Context, postID uint64) (int64, error)
}

// ReactionRepository persists `social_reactions`. Toggling a reaction is
// `Add` followed by `Aggregate` to refresh the denormalized JSON on the
// parent post; the ReactionService composes both.
type ReactionRepository interface {
	Add(ctx context.Context, r *Reaction) error
	Remove(ctx context.Context, postID, actorID uint64, kind ReactionKindStr) error
	ListByPost(ctx context.Context, postID uint64) ([]Reaction, error)
	Aggregate(ctx context.Context, postID uint64) ([]ReactionSummary, error)
	IsReactedByViewer(ctx context.Context, postID, viewerID uint64, kind ReactionKindStr) (bool, error)

	// HydrateReactedByViewer takes a slice of reaction summaries (already
	// populated with Kind+Count by `Aggregate`) and fills in the
	// `ReactedByViewer` flag for each row from one round-trip. Anonymous
	// viewer (viewerID==0) returns the input unchanged.
	HydrateReactedByViewer(ctx context.Context, postID, viewerID uint64, summaries []ReactionSummary) ([]ReactionSummary, error)
}

// ReactionKindStr is the proto enum's String() form used as the DB
// column value (e.g. "REACTION_LIKE"). Repos take the string form rather
// than the int32 proto enum so the `db` package doesn't need to depend
// on `model`.
type ReactionKindStr = string

// CircleRepository persists `social_circles` and `social_circle_members`.
// All operations are owner-scoped — the application layer ALWAYS asserts
// `circle.OwnerID == callerID` before delegating to the repo.
type CircleRepository interface {
	Create(ctx context.Context, c *Circle) error
	GetByID(ctx context.Context, id uint64) (*Circle, error)
	Update(ctx context.Context, c *Circle) error
	Delete(ctx context.Context, id, ownerID uint64) error
	ListByOwner(ctx context.Context, ownerID uint64, c Cursor, limit int) ([]*Circle, error)

	AddMembers(ctx context.Context, circleID uint64, actorDIDs []string) (added int32, total int64, err error)
	RemoveMembers(ctx context.Context, circleID uint64, actorDIDs []string) (removed int32, total int64, err error)
	ListMembers(ctx context.Context, circleID uint64, c Cursor, limit int) ([]*CircleMember, error)
	IsMember(ctx context.Context, circleID uint64, actorDID string) (bool, error)

	// MembershipsForViewer returns the IDs of circles the viewer is a
	// member of. Used by the application layer to construct a `Viewer`
	// for `CanRead` evaluation and to feed `ListByCirclesForViewer`.
	MembershipsForViewer(ctx context.Context, viewerDID string) ([]uint64, error)
}

// FollowRepository is the existing `follows` table accessor. The interface
// is kept narrow — the social subserver's RelationshipService still owns
// its own broader read API for following/follower listing; this interface
// exists only so MomentService can fetch "who do I follow" / "who follows
// me" for HOME timeline assembly without depending on RelationshipService.
type FollowRepository interface {
	// FollowingActorIDs returns the actor IDs the viewer follows. Callers
	// should expect O(followCount) memory; for celebrity accounts a
	// future iteration may need a bounded variant.
	FollowingActorIDs(ctx context.Context, viewerID uint64) ([]uint64, error)

	// FollowerActorIDs returns the actor IDs that follow `authorID`.
	// Used by the application layer when deciding whether to enqueue
	// fan-out for a FOLLOWERS-audience post.
	FollowerActorIDs(ctx context.Context, authorID uint64) ([]uint64, error)

	IsFollowing(ctx context.Context, followerID, followingID uint64) (bool, error)
}
