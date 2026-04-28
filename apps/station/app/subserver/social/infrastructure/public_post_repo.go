package infrastructure

import (
	"context"
	"errors"
	"fmt"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// publicPostRepo implements `domain.PublicPostRepository` against the
// `social_public_posts` table. PUBLIC posts have no per-viewer
// permission filter — `viewerID` is intentionally absent from every
// signature so a misuse is a compile error rather than a runtime leak.
//
// The struct holds a converter (constructed once) so list queries
// don't pay for converter allocation per row; converters are stateless
// so the shared instance is safe.
type publicPostRepo struct {
	db   *gorm.DB
	conv *domain.PostConverter
}

// NewPublicPostRepository wires the repo against an existing *gorm.DB
// handle. The handle MAY be a sub-transaction (`db.Begin()`-derived);
// MomentService threads a single TX through both the post insert and
// the audience-grant inserts when creating a CUSTOM_* post.
func NewPublicPostRepository(gdb *gorm.DB) domain.PublicPostRepository {
	return &publicPostRepo{db: gdb, conv: domain.NewPostConverter()}
}

// Create persists a public post. Panics if the supplied Post is not
// PUBLIC — that's the first defense line against the storage-separation
// invariant being violated by a service-layer bug. Panic (rather than
// returning an error) is intentional: a non-PUBLIC post landing in
// `social_public_posts` would be an immediate federation safety
// problem the moment AP outbound goes live, so we want to crash the
// request loudly in tests / staging rather than silently leak in prod.
func (r *publicPostRepo) Create(ctx context.Context, p *domain.Post) error {
	if !p.IsPublic() {
		panic(fmt.Sprintf("publicPostRepo.Create: non-PUBLIC audience kind=%s — storage-separation invariant violated", p.Audience.Kind))
	}
	row, err := r.conv.DomainToPublicDB(p)
	if err != nil {
		return err
	}
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return err
	}
	p.ID = row.ID
	p.CreatedAt = row.CreatedAt
	p.UpdatedAt = row.UpdatedAt
	return nil
}

func (r *publicPostRepo) GetByID(ctx context.Context, id uint64) (*domain.Post, error) {
	var row db.SocialPublicPost
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r.conv.PublicDBToDomain(&row), nil
}

// Delete soft-deletes by setting `deleted_at = NOW()`. Author check
// is enforced server-side via `WHERE author_id = ?` — a delete from
// the wrong author is a no-op (no error, zero rows affected). The
// application layer surfaces "no rows affected" as a 404/403 to avoid
// confirming the post's existence to a non-author.
func (r *publicPostRepo) Delete(ctx context.Context, id, authorID uint64) error {
	return r.db.WithContext(ctx).
		Model(&db.SocialPublicPost{}).
		Where("id = ? AND author_id = ? AND deleted_at IS NULL", id, authorID).
		Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

func (r *publicPostRepo) ListByAuthor(ctx context.Context, authorID uint64, c domain.Cursor, limit int) ([]*domain.Post, error) {
	q := r.db.WithContext(ctx).
		Where("author_id = ? AND deleted_at IS NULL", authorID)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPublicPost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(rows), nil
}

func (r *publicPostRepo) ListPublic(ctx context.Context, c domain.Cursor, limit int) ([]*domain.Post, error) {
	q := r.db.WithContext(ctx).
		Where("deleted_at IS NULL")
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPublicPost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(rows), nil
}

func (r *publicPostRepo) ListPublicByAuthors(ctx context.Context, authorIDs []uint64, c domain.Cursor, limit int) ([]*domain.Post, error) {
	if len(authorIDs) == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Where("author_id IN ? AND deleted_at IS NULL", authorIDs)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialPublicPost
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	return r.hydrate(rows), nil
}

// UpdateCommentsCount applies a relative delta and returns the new
// value. Negative deltas are clamped to 0 so a buggy publisher can't
// drive the counter into negative territory (sqlite would happily
// store a negative int64; clients would render "-1 comments").
//
// The implementation issues a single UPDATE + SELECT round-trip via
// GORM's `RETURNING` clause where supported, falling back to two
// separate statements where it isn't (sqlite < 3.35).
func (r *publicPostRepo) UpdateCommentsCount(ctx context.Context, id uint64, delta int64) (int64, error) {
	if err := r.db.WithContext(ctx).
		Model(&db.SocialPublicPost{}).
		Where("id = ?", id).
		Update("comments_count", gorm.Expr("MAX(0, COALESCE(comments_count,0) + ?)", delta)).Error; err != nil {
		return 0, err
	}
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialPublicPost{}).
		Select("comments_count").
		Where("id = ?", id).
		Scan(&count).Error
	return count, err
}

func (r *publicPostRepo) UpdateReactionsCount(ctx context.Context, id uint64, snapshotJSON string) error {
	return r.db.WithContext(ctx).
		Model(&db.SocialPublicPost{}).
		Where("id = ?", id).
		Update("reactions_count_json", snapshotJSON).Error
}

func (r *publicPostRepo) hydrate(rows []*db.SocialPublicPost) []*domain.Post {
	out := make([]*domain.Post, 0, len(rows))
	for _, row := range rows {
		out = append(out, r.conv.PublicDBToDomain(row))
	}
	return out
}
