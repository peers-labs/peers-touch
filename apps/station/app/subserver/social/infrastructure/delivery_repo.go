package infrastructure

import (
	"context"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type momentDeliveryRepo struct {
	db *gorm.DB
}

func NewMomentDeliveryRepository(gdb *gorm.DB) domain.MomentDeliveryRepository {
	return &momentDeliveryRepo{db: gdb}
}

func (r *momentDeliveryRepo) Upsert(ctx context.Context, deliveries []domain.MomentDelivery) error {
	if len(deliveries) == 0 {
		return nil
	}
	rows := make([]db.SocialMomentDelivery, 0, len(deliveries))
	for _, d := range deliveries {
		if d.ViewerID == 0 || d.PostID == 0 {
			continue
		}
		rows = append(rows, db.SocialMomentDelivery{
			ViewerID:     d.ViewerID,
			PostID:       d.PostID,
			AuthorID:     d.AuthorID,
			AudienceKind: d.AudienceKind,
			DeliveredAt:  d.DeliveredAt,
			RevokedAt:    d.RevokedAt,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "viewer_id"}, {Name: "post_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"author_id", "audience_kind", "delivered_at", "revoked_at"}),
		}).
		Create(&rows).Error
}

func (r *momentDeliveryRepo) ListInbox(ctx context.Context, viewerID uint64, c domain.Cursor, limit int) ([]domain.MomentDelivery, error) {
	if viewerID == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Where("viewer_id = ? AND revoked_at IS NULL", viewerID)
	if !c.IsZero() {
		q = q.Where("(delivered_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []db.SocialMomentDelivery
	if err := q.Order("delivered_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.MomentDelivery, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.MomentDelivery{
			ID:           row.ID,
			ViewerID:     row.ViewerID,
			PostID:       row.PostID,
			AuthorID:     row.AuthorID,
			AudienceKind: row.AudienceKind,
			DeliveredAt:  row.DeliveredAt,
			RevokedAt:    row.RevokedAt,
		})
	}
	return out, nil
}

func (r *momentDeliveryRepo) RevokePost(ctx context.Context, postID uint64) error {
	if postID == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&db.SocialMomentDelivery{}).
		Where("post_id = ? AND revoked_at IS NULL", postID).
		Update("revoked_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}
