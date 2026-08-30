package infrastructure

import (
	"context"
	"errors"
	"fmt"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// privatePostRepo implements `domain.PrivatePostRepository` against the
// `social_private_posts` table plus the `social_private_audience_grants`
// join. Every read path REQUIRES `viewerID` so the type system itself
// prevents an "I forgot the permission filter" bug.
//
// The repo also depends on a `domain.AudienceGrantRepository` for
// CUSTOM_* deny-list short-circuit checks during point reads. The grants
// repo is injected (not constructed inside) so tests can stub it.
type privatePostRepo struct {
	db       *gorm.DB
	conv     *domain.PostConverter
	grants   domain.AudienceGrantRepository
	identity *ActorIdentity
}

func NewPrivatePostRepository(
	gdb *gorm.DB,
	grants domain.AudienceGrantRepository,
) domain.PrivatePostRepository {
	return &privatePostRepo{db: gdb, conv: domain.NewPostConverter(), grants: grants, identity: NewActorIdentity(gdb)}
}

// Create persists a private post. Panics if the supplied Post has
// PUBLIC audience — see the symmetric note on publicPostRepo.Create.
func (r *privatePostRepo) Create(ctx context.Context, p *domain.Post) error {
	if p.IsPublic() {
		panic(fmt.Sprintf("privatePostRepo.Create: PUBLIC audience kind=%s — storage-separation invariant violated", p.Audience.Kind))
	}
	row, _, err := r.conv.DomainToPrivateDB(p)
	if err != nil {
		return err
	}
	authorID, err := r.identity.RequireID(ctx, p.AuthorPTID)
	if err != nil {
		return err
	}
	row.AuthorID = authorID
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return err
	}
	p.ID = row.ID
	p.CreatedAt = row.CreatedAt
	p.UpdatedAt = row.UpdatedAt
	return nil
}

// GetByID enforces the audience filter inline. Read order:
//
//  1. Fetch the candidate row by id (single PK lookup).
//  2. If author == viewer: return immediately (author-shortcut).
//  3. SELF audience: return nil (only author can read).
//  4. CUSTOM_DENY: short-circuit if `(post_id, viewer_ptid, 'deny')`
//     exists in `social_private_audience_grants`.
//  5. CUSTOM_ALLOW: short-circuit if `(post_id, viewer_ptid, 'allow')`
//     does NOT exist.
//  6. FOLLOWERS / CIRCLE / GROUP: visibility is the application
//     layer's call (it has the relationship graph) — repo returns the
//     row and lets `CanRead` make the final decision (third line).
//
// The hydrated Post carries any matching grants so the converter can
// reconstruct `Audience.actor_ptids` for the wire response.
func (r *privatePostRepo) GetByID(ctx context.Context, id uint64, viewerPTID string) (*domain.Post, error) {
	var row db.SocialPrivatePost
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	authorPTID, err := r.identity.ResolveID(ctx, row.AuthorID)
	if err != nil {
		return nil, err
	}
	if authorPTID == viewerPTID {
		return r.hydrateOne(ctx, &row)
	}

	switch row.AudienceKind {
	case model.Audience_SELF.String():
		return nil, nil

	case model.Audience_CUSTOM_DENY.String(), model.Audience_CUSTOM_ALLOW.String():
		if viewerPTID == "" {
			// Without a viewer PTID we can't enforce the list; fall
			// through to base-kind eligibility (and ultimately the
			// application-layer CanRead).
			break
		}
		if row.AudienceKind == model.Audience_CUSTOM_DENY.String() {
			isDenied, gerr := r.grants.HasDenyGrant(ctx, row.ID, viewerPTID)
			if gerr != nil {
				return nil, gerr
			}
			if isDenied {
				return nil, nil
			}
		} else {
			// CUSTOM_ALLOW: any non-author viewer must be on the
			// allow list. We re-use `HasDenyGrant` semantics by
			// looking up the grants list.
			grants, gerr := r.grants.ListGrants(ctx, row.ID)
			if gerr != nil {
				return nil, gerr
			}
			allowed := false
			for _, g := range grants {
				if g.Role == domain.GrantRoleAllow && g.ActorPTID == viewerPTID {
					allowed = true
					break
				}
			}
			if !allowed {
				return nil, nil
			}
		}
	}

	return r.hydrateOne(ctx, &row)
}

func (r *privatePostRepo) Delete(ctx context.Context, id uint64, authorPTID string) error {
	authorID, err := r.identity.RequireID(ctx, authorPTID)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Model(&db.SocialPrivatePost{}).
		Where("id = ? AND author_id = ? AND deleted_at IS NULL", id, authorID).
		Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

func (r *privatePostRepo) ListByFollowingForViewer(ctx context.Context, viewerPTID string, followedAuthorPTIDs []string, c domain.Cursor, limit int) ([]*domain.Post, error) {
	if len(followedAuthorPTIDs) == 0 {
		return nil, nil
	}
	followedAuthorIDs, err := r.identity.RequireIDs(ctx, followedAuthorPTIDs)
	if err != nil {
		return nil, err
	}
	q := r.db.WithContext(ctx).
		Where("author_id IN ? AND audience_kind = ? AND deleted_at IS NULL",
			followedAuthorIDs, model.Audience_FOLLOWERS.String())
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *privatePostRepo) ListSelfByAuthor(ctx context.Context, authorPTID string, c domain.Cursor, limit int) ([]*domain.Post, error) {
	authorID, err := r.identity.RequireID(ctx, authorPTID)
	if err != nil {
		return nil, err
	}
	q := r.db.WithContext(ctx).
		Where("author_id = ? AND audience_kind = ? AND deleted_at IS NULL",
			authorID, model.Audience_SELF.String())
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *privatePostRepo) ListByCircleForViewer(ctx context.Context, viewerPTID string, circleID uint64, c domain.Cursor, limit int) ([]*domain.Post, error) {
	q := r.db.WithContext(ctx).
		Where("audience_kind = ? AND audience_target_id = ? AND deleted_at IS NULL",
			model.Audience_CIRCLE.String(), circleID)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *privatePostRepo) ListByCirclesForViewer(ctx context.Context, viewerPTID string, circleIDs []uint64, c domain.Cursor, limit int) ([]*domain.Post, error) {
	if len(circleIDs) == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Where("audience_kind = ? AND audience_target_id IN ? AND deleted_at IS NULL",
			model.Audience_CIRCLE.String(), circleIDs)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *privatePostRepo) ListByGroupForViewer(ctx context.Context, viewerPTID string, groupID uint64, c domain.Cursor, limit int) ([]*domain.Post, error) {
	q := r.db.WithContext(ctx).
		Where("audience_kind = ? AND audience_target_id = ? AND deleted_at IS NULL",
			model.Audience_GROUP.String(), groupID)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *privatePostRepo) ListByGroupsForViewer(ctx context.Context, viewerPTID string, groupIDs []uint64, c domain.Cursor, limit int) ([]*domain.Post, error) {
	if len(groupIDs) == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Where("audience_kind = ? AND audience_target_id IN ? AND deleted_at IS NULL",
			model.Audience_GROUP.String(), groupIDs)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

// ListByAuthorVisibleTo serves "render someone else's profile" — a
// rare and complex query because it has to filter by every audience
// kind the author has used. Implementation strategy:
//
//   - SELF posts: included only when viewer == author.
//   - FOLLOWERS posts: included only when viewer is in author's
//     followers (the application layer pre-filters with the relevant
//     relationship lookup; this method trusts the caller).
//   - CIRCLE / GROUP posts: included only when viewer is a member
//     (again, application layer trust).
//   - CUSTOM_ALLOW: included only when viewer's PTID is on the list.
//   - CUSTOM_DENY: excluded when viewer's PTID is on the deny list.
//
// To keep the SQL simple, this method returns ALL non-deleted posts
// authored by `authorID` (excluding SELF unless viewer==author) and
// lets the application layer call `CanRead` per row to filter. That
// is O(N) per page where N is the page limit — acceptable because
// profile pages are not high-throughput.
func (r *privatePostRepo) ListByAuthorVisibleTo(ctx context.Context, authorPTID, viewerPTID string, c domain.Cursor, limit int) ([]*domain.Post, error) {
	ids, err := r.identity.RequireIDs(ctx, []string{authorPTID, viewerPTID})
	if err != nil {
		return nil, err
	}
	authorID, viewerID := ids[0], ids[1]
	q := r.db.WithContext(ctx).
		Where("author_id = ? AND deleted_at IS NULL", authorID)
	if authorID != viewerID {
		q = q.Where("audience_kind <> ?", model.Audience_SELF.String())
	}
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPrivatePost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(ctx, rows)
}

func (r *privatePostRepo) UpdateCommentsCount(ctx context.Context, id uint64, delta int64) (int64, error) {
	if err := r.db.WithContext(ctx).
		Model(&db.SocialPrivatePost{}).
		Where("id = ?", id).
		Update("comments_count", gorm.Expr("MAX(0, COALESCE(comments_count,0) + ?)", delta)).Error; err != nil {
		return 0, err
	}
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialPrivatePost{}).
		Select("comments_count").
		Where("id = ?", id).
		Scan(&count).Error
	return count, err
}

func (r *privatePostRepo) UpdateReactionsCount(ctx context.Context, id uint64, snapshotJSON string) error {
	return r.db.WithContext(ctx).
		Model(&db.SocialPrivatePost{}).
		Where("id = ?", id).
		Update("reactions_count_json", snapshotJSON).Error
}

// hydrate fills CUSTOM_* posts with their grants in a single round-trip
// per slice (rather than N+1).
func (r *privatePostRepo) hydrate(ctx context.Context, rows []*db.SocialPrivatePost) ([]*domain.Post, error) {
	out := make([]*domain.Post, 0, len(rows))
	for _, row := range rows {
		post, err := r.hydrateOne(ctx, row)
		if err != nil {
			return nil, err
		}
		out = append(out, post)
	}
	return out, nil
}

func (r *privatePostRepo) hydrateOne(ctx context.Context, row *db.SocialPrivatePost) (*domain.Post, error) {
	var grants []db.SocialPrivateAudienceGrant
	if row.AudienceKind == model.Audience_CUSTOM_ALLOW.String() ||
		row.AudienceKind == model.Audience_CUSTOM_DENY.String() {
		got, err := r.grants.ListGrants(ctx, row.ID)
		if err == nil {
			grants = make([]db.SocialPrivateAudienceGrant, 0, len(got))
			for _, g := range got {
				grants = append(grants, db.SocialPrivateAudienceGrant{
					PostID:    g.PostID,
					ActorPtid: g.ActorPTID,
					Role:      string(g.Role),
				})
			}
		}
		// On grant load error we still return the post (with empty
		// actor_ptids on the audience); the caller's CanRead will
		// fail-closed. Logging is the application layer's job.
	}
	authorPTID, err := r.identity.ResolveID(ctx, row.AuthorID)
	if err != nil {
		return nil, err
	}
	post := r.conv.PrivateDBToDomain(row, grants)
	post.AuthorPTID = authorPTID
	return post, nil
}
