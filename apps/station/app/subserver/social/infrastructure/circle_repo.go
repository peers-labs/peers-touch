package infrastructure

import (
	"context"
	"errors"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// circleRepo implements `domain.CircleRepository`. All write operations
// require an `ownerID` parameter (or rely on the caller having set
// `Circle.OwnerID`) — the application layer ALWAYS asserts
// `circle.OwnerID == callerID` before delegating, so the repo can
// trust the caller for ownership.
type circleRepo struct {
	db   *gorm.DB
	conv *domain.PostConverter
}

func NewCircleRepository(gdb *gorm.DB) domain.CircleRepository {
	return &circleRepo{db: gdb, conv: domain.NewPostConverter()}
}

func (r *circleRepo) Create(ctx context.Context, c *domain.Circle) error {
	row := r.conv.CircleToDB(c)
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return err
	}
	c.ID = row.ID
	c.CreatedAt = row.CreatedAt
	c.UpdatedAt = row.UpdatedAt
	return nil
}

func (r *circleRepo) GetByID(ctx context.Context, id uint64) (*domain.Circle, error) {
	var row db.SocialCircle
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r.conv.CircleFromDB(&row), nil
}

// Update only touches `name` / `description` — owner / id / member_count
// / created_at must not change post-creation. The application layer
// (CircleService.Rename) constructs the patch.
func (r *circleRepo) Update(ctx context.Context, c *domain.Circle) error {
	return r.db.WithContext(ctx).
		Model(&db.SocialCircle{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", c.ID, c.OwnerID).
		Updates(map[string]any{
			"name":        c.Name,
			"description": c.Description,
		}).Error
}

func (r *circleRepo) Delete(ctx context.Context, id, ownerID uint64) error {
	return r.db.WithContext(ctx).
		Model(&db.SocialCircle{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
		Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

func (r *circleRepo) ListByOwner(ctx context.Context, ownerID uint64, c domain.Cursor, limit int) ([]*domain.Circle, error) {
	q := r.db.WithContext(ctx).
		Where("owner_id = ? AND deleted_at IS NULL", ownerID)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialCircle
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Circle, 0, len(rows))
	for _, row := range rows {
		out = append(out, r.conv.CircleFromDB(row))
	}
	return out, nil
}

// AddMembers writes new (CircleID, ActorDID) tuples and bumps the
// denormalized `member_count`. Duplicates are silently ignored — the
// composite-PK insert returns an error per row, so the implementation
// dedups the input slice first and only inserts rows that don't yet
// exist. Returns the number actually added.
func (r *circleRepo) AddMembers(ctx context.Context, circleID uint64, actorDIDs []string) (added int32, total int64, err error) {
	if len(actorDIDs) == 0 {
		var count int64
		_ = r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).Count(&count).Error
		return 0, count, nil
	}

	// Dedup input.
	seen := make(map[string]struct{}, len(actorDIDs))
	uniq := make([]string, 0, len(actorDIDs))
	for _, d := range actorDIDs {
		if d == "" {
			continue
		}
		if _, ok := seen[d]; ok {
			continue
		}
		seen[d] = struct{}{}
		uniq = append(uniq, d)
	}

	// Find which DIDs are already members so we can compute `added`
	// accurately.
	var existing []string
	if err = r.db.WithContext(ctx).
		Model(&db.SocialCircleMember{}).
		Where("circle_id = ? AND actor_did IN ?", circleID, uniq).
		Pluck("actor_did", &existing).Error; err != nil {
		return 0, 0, err
	}
	already := make(map[string]struct{}, len(existing))
	for _, d := range existing {
		already[d] = struct{}{}
	}

	rows := make([]db.SocialCircleMember, 0, len(uniq))
	now := time.Now()
	for _, d := range uniq {
		if _, ok := already[d]; ok {
			continue
		}
		rows = append(rows, db.SocialCircleMember{
			CircleID: circleID,
			ActorDID: d,
			AddedAt:  now,
		})
	}
	if len(rows) > 0 {
		if err = r.db.WithContext(ctx).Create(&rows).Error; err != nil {
			return 0, 0, err
		}
		if err = r.db.WithContext(ctx).
			Model(&db.SocialCircle{}).
			Where("id = ?", circleID).
			Update("member_count", gorm.Expr("COALESCE(member_count,0) + ?", len(rows))).Error; err != nil {
			return 0, 0, err
		}
	}

	var count int64
	if cerr := r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
		Where("circle_id = ?", circleID).Count(&count).Error; cerr != nil {
		return int32(len(rows)), 0, cerr
	}
	return int32(len(rows)), count, nil
}

func (r *circleRepo) RemoveMembers(ctx context.Context, circleID uint64, actorDIDs []string) (removed int32, total int64, err error) {
	if len(actorDIDs) == 0 {
		var count int64
		_ = r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).Count(&count).Error
		return 0, count, nil
	}
	res := r.db.WithContext(ctx).
		Where("circle_id = ? AND actor_did IN ?", circleID, actorDIDs).
		Delete(&db.SocialCircleMember{})
	if res.Error != nil {
		return 0, 0, res.Error
	}
	removed = int32(res.RowsAffected)
	if removed > 0 {
		if err = r.db.WithContext(ctx).
			Model(&db.SocialCircle{}).
			Where("id = ?", circleID).
			Update("member_count", gorm.Expr("MAX(0, COALESCE(member_count,0) - ?)", removed)).Error; err != nil {
			return removed, 0, err
		}
	}
	var count int64
	if cerr := r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
		Where("circle_id = ?", circleID).Count(&count).Error; cerr != nil {
		return removed, 0, cerr
	}
	return removed, count, nil
}

func (r *circleRepo) ListMembers(ctx context.Context, circleID uint64, c domain.Cursor, limit int) ([]*domain.CircleMember, error) {
	q := r.db.WithContext(ctx).Where("circle_id = ?", circleID)
	if !c.IsZero() {
		// Members don't have a numeric id; cursor uses (added_at, did)
		// — `LastID` here is unused (membership PK is composite); we
		// just paginate by `added_at`.
		q = q.Where("added_at < ?", c.CreatedAt)
	}
	var rows []*db.SocialCircleMember
	if err := q.Order("added_at DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.CircleMember, 0, len(rows))
	for _, row := range rows {
		out = append(out, &domain.CircleMember{
			CircleID: row.CircleID,
			ActorDID: row.ActorDID,
			AddedAt:  row.AddedAt,
		})
	}
	return out, nil
}

func (r *circleRepo) IsMember(ctx context.Context, circleID uint64, actorDID string) (bool, error) {
	if actorDID == "" {
		return false, nil
	}
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialCircleMember{}).
		Where("circle_id = ? AND actor_did = ?", circleID, actorDID).
		Count(&count).Error
	return count > 0, err
}

// MembershipsForViewer returns the IDs of circles `viewerDID` belongs
// to. Used by the application layer to construct a `Viewer` for
// `CanRead` evaluation and to feed `ListByCirclesForViewer`.
func (r *circleRepo) MembershipsForViewer(ctx context.Context, viewerDID string) ([]uint64, error) {
	if viewerDID == "" {
		return nil, nil
	}
	var ids []uint64
	err := r.db.WithContext(ctx).
		Model(&db.SocialCircleMember{}).
		Where("actor_did = ?", viewerDID).
		Pluck("circle_id", &ids).Error
	return ids, err
}
