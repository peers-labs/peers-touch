package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// SocialMomentDelivery materializes one private Moment into one viewer's
// HOME inbox. PUBLIC Moments are not written here; they stay on the public
// feed path so private delivery cannot accidentally widen public reads.
type SocialMomentDelivery struct {
	ID uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`

	ViewerID uint64 `gorm:"column:viewer_id;uniqueIndex:idx_smd_viewer_post;index:idx_smd_viewer_delivered;not null"`
	PostID   uint64 `gorm:"column:post_id;uniqueIndex:idx_smd_viewer_post;index:idx_smd_post;not null"`
	AuthorID uint64 `gorm:"column:author_id;index:idx_smd_author;not null"`

	AudienceKind string `gorm:"column:audience_kind;type:varchar(16);not null"`

	DeliveredAt time.Time  `gorm:"column:delivered_at;index:idx_smd_viewer_delivered"`
	RevokedAt   *time.Time `gorm:"column:revoked_at;index"`
}

func (SocialMomentDelivery) TableName() string { return "social_moment_deliveries" }

func (d *SocialMomentDelivery) BeforeCreate(tx *gorm.DB) error {
	if d.ID == 0 {
		d.ID = id.NextID()
	}
	return nil
}
