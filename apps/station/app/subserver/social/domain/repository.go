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
// `docs/architecture/domains/social/core/moments.md §8`).
type PublicPostRepository interface {
	Create(ctx context.Context, p *Post) error
	GetByID(ctx context.Context, id uint64) (*Post, error)
	ProbeRecordState(ctx context.Context, id uint64) (PostRecordState, error)
	Delete(ctx context.Context, id uint64, authorPTID string) error

	ListByAuthor(ctx context.Context, authorPTID string, c Cursor, limit int) ([]*Post, error)
	ListPublic(ctx context.Context, c Cursor, limit int) ([]*Post, error)

	// ListPublicByAuthors returns the most recent public posts authored
	// by any of `authorIDs`. Used to feed the "public-followed" stream of
	// the HOME multi-source merge. Empty `authorIDs` → empty result.
	ListPublicByAuthors(ctx context.Context, authorPTIDs []string, c Cursor, limit int) ([]*Post, error)

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

// PostRecordState is an owner-internal lifecycle projection. It intentionally
// carries no author, audience, or content fields, so application policy can
// classify a point read without exposing a hidden row.
type PostRecordState uint8

const (
	PostRecordMissing PostRecordState = iota
	PostRecordLive
	PostRecordDeleted
)

type MomentDelivery struct {
	ID           uint64
	ViewerPTID   string
	PostID       uint64
	AuthorPTID   string
	AudienceKind string
	DeliveredAt  time.Time
	RevokedAt    *time.Time
}

// MomentDeliveryRepository persists viewer-scoped HOME inbox rows for
// private Moments. It is the durable counterpart to realtime fan-out.
type MomentDeliveryRepository interface {
	Upsert(ctx context.Context, deliveries []MomentDelivery) error
	ListInbox(ctx context.Context, viewerPTID string, c Cursor, limit int) ([]MomentDelivery, error)
	RevokePost(ctx context.Context, postID uint64) error
}

type MomentsStatsSnapshot struct {
	PostsCount             int64
	CommentsCount          int64
	ReactionsGivenCount    int64
	CommentsReceivedCount  int64
	ReactionsReceivedCount int64
	CirclesCount           int64
}

// MomentsStatsRepository resolves PTID at the persistence boundary and keeps
// numeric actor foreign keys private to its database queries.
type MomentsStatsRepository interface {
	GetByActorPTID(ctx context.Context, actorPTID string) (MomentsStatsSnapshot, error)
}

// CommentRepository persists `social_comments`. Comments are stored in a
// single table for both post classes (with `PostClass` denormalized) so
// cursor pagination doesn't need a UNION across two tables.
type CommentRepository interface {
	Create(ctx context.Context, c *Comment) error
	GetByID(ctx context.Context, id uint64) (*Comment, error)
	Delete(ctx context.Context, id uint64, authorPTID string) error
	ListByPost(ctx context.Context, postID uint64, c Cursor, limit int) ([]*Comment, error)
	CountByPost(ctx context.Context, postID uint64) (int64, error)
}

// ReactionRepository persists `social_reactions`. Toggling a reaction is
// `Add` followed by `Aggregate` to refresh the denormalized JSON on the
// parent post; the ReactionService composes both.
type ReactionRepository interface {
	Add(ctx context.Context, r *Reaction) error
	Remove(ctx context.Context, postID string, actorPTID string, kind ReactionKindStr) error
	ListByPost(ctx context.Context, postID string) ([]Reaction, error)
	Aggregate(ctx context.Context, postID string) ([]ReactionSummary, error)
	IsReactedByViewer(ctx context.Context, postID string, viewerPTID string, kind ReactionKindStr) (bool, error)
	MutatePrivatePost(
		ctx context.Context,
		postID string,
		actorPTID string,
		kind ReactionKindStr,
		remove bool,
	) (string, []Reaction, error)

	// HydrateReactedByViewer takes a slice of reaction summaries (already
	// populated with Kind+Count by `Aggregate`) and fills in the
	// `ReactedByViewer` flag for each row from one round-trip. Anonymous
	// viewer (viewerID==0) returns the input unchanged.
	HydrateReactedByViewer(ctx context.Context, postID string, viewerPTID string, summaries []ReactionSummary) ([]ReactionSummary, error)
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
	Delete(ctx context.Context, id uint64, ownerPTID string) error
	ListByOwner(ctx context.Context, ownerPTID string, c Cursor, limit int) ([]*Circle, error)

	AddMembers(ctx context.Context, circleID uint64, actorPTIDs []string) (added int32, total int64, err error)
	RemoveMembers(ctx context.Context, circleID uint64, actorPTIDs []string) (removed int32, total int64, err error)
	ListMembers(ctx context.Context, circleID uint64, c Cursor, limit int) ([]*CircleMember, error)
	IsMember(ctx context.Context, circleID uint64, actorPTID string) (bool, error)

	// MembershipsForViewer returns the IDs of circles the viewer is a
	// member of. Used by the application layer to construct a `Viewer`
	// for `CanRead` evaluation and to feed `ListByCirclesForViewer`.
	MembershipsForViewer(ctx context.Context, viewerPTID string) ([]uint64, error)
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
	FollowingActorPTIDs(ctx context.Context, viewerPTID string) ([]string, error)

	// FollowerActorIDs returns the actor IDs that follow `authorID`.
	// Used by the application layer when deciding whether to enqueue
	// fan-out for a FOLLOWERS-audience post.
	FollowerActorPTIDs(ctx context.Context, authorPTID string) ([]string, error)

	IsFollowing(ctx context.Context, followerPTID, followingPTID string) (bool, error)
}

// StationModerationRepository persists Station-scoped trust policy.
// Unlike actor block, this is not a social relationship edge; it is a
// Station policy source consumed by feed projection and action gates.
type StationModerationRepository interface {
	Upsert(ctx context.Context, policy *StationModerationPolicy) error
	Delete(ctx context.Context, stationDomain, stationPeerID string, kind StationModerationPolicyKind) error
	List(ctx context.Context, kind StationModerationPolicyKind, c Cursor, limit int) ([]*StationModerationPolicy, error)
	IsBlockedStation(ctx context.Context, stationDomain, stationPeerID string) (bool, error)
	ListBlockedStations(ctx context.Context) (map[string]*StationModerationPolicy, error)
}
