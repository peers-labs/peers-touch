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
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSocialRelationshipAuthority(tx, c.OwnerPTID); err != nil {
			return err
		}
		return tx.
			Model(&db.SocialCircle{}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", c.ID, ownerID).
			Updates(map[string]any{
				"name":        c.Name,
				"description": c.Description,
			}).Error
	})
}

func (r *circleRepo) Delete(ctx context.Context, id uint64, ownerPTID string) error {
	ownerID, err := r.identity.RequireID(ctx, ownerPTID)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSocialRelationshipAuthority(tx, ownerPTID); err != nil {
			return err
		}
		return tx.
			Model(&db.SocialCircle{}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
			Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
	})
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

	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCircleAudienceAuthority(ctx, tx, circleID); err != nil {
			return err
		}
		var existing []string
		if err := tx.
			Model(&db.SocialCircleMember{}).
			Where("circle_id = ? AND actor_ptid IN ?", circleID, uniq).
			Pluck("actor_ptid", &existing).Error; err != nil {
			return err
		}
		already := make(map[string]struct{}, len(existing))
		for _, actorPTID := range existing {
			already[actorPTID] = struct{}{}
		}
		rows := make([]db.SocialCircleMember, 0, len(uniq))
		now := time.Now()
		for _, actorPTID := range uniq {
			if _, ok := already[actorPTID]; ok {
				continue
			}
			rows = append(rows, db.SocialCircleMember{
				CircleID:  circleID,
				ActorPtid: actorPTID,
				AddedAt:   now,
			})
		}
		if len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
			if err := tx.
				Model(&db.SocialCircle{}).
				Where("id = ?", circleID).
				Update("member_count", gorm.Expr("COALESCE(member_count,0) + ?", len(rows))).Error; err != nil {
				return err
			}
		}
		added = int32(len(rows))
		return tx.Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).
			Count(&total).Error
	})
	return added, total, err
}

func (r *circleRepo) RemoveMembers(ctx context.Context, circleID uint64, actorPTIDs []string) (removed int32, total int64, err error) {
	if len(actorPTIDs) == 0 {
		var count int64
		_ = r.db.WithContext(ctx).Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).Count(&count).Error
		return 0, count, nil
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCircleAudienceAuthority(ctx, tx, circleID); err != nil {
			return err
		}
		result := tx.
			Where("circle_id = ? AND actor_ptid IN ?", circleID, actorPTIDs).
			Delete(&db.SocialCircleMember{})
		if result.Error != nil {
			return result.Error
		}
		removed = int32(result.RowsAffected)
		if removed > 0 {
			if err := tx.
				Model(&db.SocialCircle{}).
				Where("id = ?", circleID).
				Update("member_count", gorm.Expr("MAX(0, COALESCE(member_count,0) - ?)", removed)).Error; err != nil {
				return err
			}
		}
		return tx.Model(&db.SocialCircleMember{}).
			Where("circle_id = ?", circleID).
			Count(&total).Error
	})
	return removed, total, err
}

func lockCircleAudienceAuthority(
	ctx context.Context,
	database *gorm.DB,
	circleID uint64,
) error {
	var owner struct {
		PTID string `gorm:"column:ptid"`
	}
	if err := database.WithContext(ctx).
		Table("social_circles AS circle").
		Select("owner.ptid AS ptid").
		Joins("JOIN touch_actor AS owner ON owner.id = circle.owner_id").
		Where("circle.id = ? AND circle.deleted_at IS NULL", circleID).
		Take(&owner).Error; err != nil {
		return err
	}
	return lockSocialRelationshipAuthority(database, owner.PTID)
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
