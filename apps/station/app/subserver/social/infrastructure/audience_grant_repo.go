package infrastructure

import (
	"context"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// audienceGrantRepo implements `domain.AudienceGrantRepository` against
// the `social_private_audience_grants` table. The lifecycle of grant
// rows is bound to the parent post — MomentService.Create writes them
// in the same transaction as the post insert; MomentService.Delete
// removes them in the same TX as the post tombstone.
type audienceGrantRepo struct {
	db *gorm.DB
}

func NewAudienceGrantRepository(gdb *gorm.DB) domain.AudienceGrantRepository {
	return &audienceGrantRepo{db: gdb}
}

func (r *audienceGrantRepo) AddGrants(ctx context.Context, postID uint64, grants []domain.AudienceGrant) error {
	if len(grants) == 0 {
		return nil
	}
	rows := make([]db.SocialPrivateAudienceGrant, 0, len(grants))
	now := time.Now()
	for _, g := range grants {
		rows = append(rows, db.SocialPrivateAudienceGrant{
			PostID:    postID,
			ActorDID:  g.ActorDID,
			Role:      string(g.Role),
			CreatedAt: now,
		})
	}
	return r.db.WithContext(ctx).Create(&rows).Error
}

func (r *audienceGrantRepo) ListGrants(ctx context.Context, postID uint64) ([]domain.AudienceGrant, error) {
	var rows []db.SocialPrivateAudienceGrant
	err := r.db.WithContext(ctx).
		Where("post_id = ?", postID).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.AudienceGrant, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.AudienceGrant{
			PostID:   r.PostID,
			ActorDID: r.ActorDID,
			Role:     domain.GrantRole(r.Role),
		})
	}
	return out, nil
}

func (r *audienceGrantRepo) DeleteGrants(ctx context.Context, postID uint64) error {
	return r.db.WithContext(ctx).
		Where("post_id = ?", postID).
		Delete(&db.SocialPrivateAudienceGrant{}).Error
}

// HasDenyGrant is the SQL-fast-path used by `PrivatePostRepository.GetByID`
// to short-circuit "viewer is on a CUSTOM_DENY list" before returning a
// row. Single-row composite-PK lookup, fully indexed.
func (r *audienceGrantRepo) HasDenyGrant(ctx context.Context, postID uint64, actorDID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialPrivateAudienceGrant{}).
		Where("post_id = ? AND actor_did = ? AND role = ?",
			postID, actorDID, db.AudienceGrantRoleDeny).
		Count(&count).Error
	return count > 0, err
}
