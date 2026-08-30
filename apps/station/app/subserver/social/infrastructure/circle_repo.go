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
	db       *gorm.DB
	conv     *domain.PostConverter
	identity *ActorIdentity
}

func NewCircleRepository(gdb *gorm.DB) domain.CircleRepository {
	return &circleRepo{db: gdb, conv: domain.NewPostConverter(), identity: NewActorIdentity(gdb)}
}

func (r *circleRepo) Create(ctx context.Context, c *domain.Circle) error {
	row := r.conv.CircleToDB(c)
	ownerID, err := r.identity.RequireID(ctx, c.OwnerPTID)
	if err != nil {
		return err
	}
	row.OwnerID = ownerID
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
	return r.hydrateOne(ctx, &row)
}

// Update only touches `name` / `description` — owner / id / member_count
// / created_at must not change post-creation. The application layer
// (CircleService.Rename) constructs the patch.
func (r *circleRepo) Update(ctx context.Context, c *domain.Circle) error {
	ownerID, err := r.identity.RequireID(ctx, c.OwnerPTID)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Model(&db.SocialCircle{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", c.ID, ownerID).
		Updates(map[string]any{
			"name":        c.Name,
			"description": c.Description,
		}).Error
}

func (r *circleRepo) Delete(ctx context.Context, id uint64, ownerPTID string) error {
	ownerID, err := r.identity.RequireID(ctx, ownerPTID)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Model(&db.SocialCircle{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
		Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

func (r *circleRepo) ListByOwner(ctx context.Context, ownerPTID string, c domain.Cursor, limit int) ([]*domain.Circle, error) {
	ownerID, err := r.identity.RequireID(ctx, ownerPTID)
	if err != nil {
		return nil, err
	}
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
		circle, err := r.hydrateOne(ctx, row)
		if err != nil {
			return nil, err
		}
		out = append(out, circle)
	}
	return out, nil
}

func (r *circleRepo) hydrateOne(ctx context.Context, row *db.SocialCircle) (*domain.Circle, error) {
	ownerPTID, err := r.identity.ResolveID(ctx, row.OwnerID)
	if err != nil {
		return nil, err
	}
	circle := r.conv.CircleFromDB(row)
	circle.OwnerPTID = ownerPTID
	return circle, nil
}

// AddMembers writes new (CircleID, ActorPTID) tuples and bumps the
// denormalized `member_count`. Duplicates are silently ignored — the
// composite-PK insert returns an error per row, so the implementation
// dedups the input slice first and only inserts rows that don't yet
// exist. Returns the number actually added.
func (r *circleRepo) AddMembers(ctx context.Context, circleID uint64, actorPTIDs []string) (added int32, total int64, err error) {
	if len(actorPTIDs) == 0 {
		var count int64
		_ = r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).Count(&count).Error
		return 0, count, nil
	}

	// Dedup input.
	seen := make(map[string]struct{}, len(actorPTIDs))
	uniq := make([]string, 0, len(actorPTIDs))
	for _, ptid := range actorPTIDs {
		if ptid == "" {
			continue
		}
		if _, ok := seen[ptid]; ok {
			continue
		}
		seen[ptid] = struct{}{}
		uniq = append(uniq, ptid)
	}

	// Find which PTIDs are already members so we can compute `added`
	// accurately.
	var existing []string
	if err = r.db.WithContext(ctx).
		Model(&db.SocialCircleMember{}).
		Where("circle_id = ? AND actor_ptid IN ?", circleID, uniq).
		Pluck("actor_ptid", &existing).Error; err != nil {
		return 0, 0, err
	}
	already := make(map[string]struct{}, len(existing))
	for _, d := range existing {
		already[d] = struct{}{}
	}

	rows := make([]db.SocialCircleMember, 0, len(uniq))
	now := time.Now()
	for _, ptid := range uniq {
		if _, ok := already[ptid]; ok {
			continue
		}
		rows = append(rows, db.SocialCircleMember{
			CircleID:  circleID,
			ActorPtid: ptid,
			AddedAt:   now,
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

func (r *circleRepo) RemoveMembers(ctx context.Context, circleID uint64, actorPTIDs []string) (removed int32, total int64, err error) {
	if len(actorPTIDs) == 0 {
		var count int64
		_ = r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).Count(&count).Error
		return 0, count, nil
	}
	res := r.db.WithContext(ctx).
		Where("circle_id = ? AND actor_ptid IN ?", circleID, actorPTIDs).
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
			CircleID:  row.CircleID,
			ActorPTID: row.ActorPtid,
			AddedAt:   row.AddedAt,
		})
	}
	return out, nil
}

func (r *circleRepo) IsMember(ctx context.Context, circleID uint64, actorPTID string) (bool, error) {
	if actorPTID == "" {
		return false, nil
	}
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialCircleMember{}).
		Where("circle_id = ? AND actor_ptid = ?", circleID, actorPTID).
		Count(&count).Error
	return count > 0, err
}

// MembershipsForViewer returns the IDs of circles `viewerPTID` belongs
// to. Used by the application layer to construct a `Viewer` for
// `CanRead` evaluation and to feed `ListByCirclesForViewer`.
func (r *circleRepo) MembershipsForViewer(ctx context.Context, viewerPTID string) ([]uint64, error) {
	if viewerPTID == "" {
		return nil, nil
	}
	var ids []uint64
	err := r.db.WithContext(ctx).
		Model(&db.SocialCircleMember{}).
		Where("actor_ptid = ?", viewerPTID).
		Pluck("circle_id", &ids).Error
	return ids, err
}
