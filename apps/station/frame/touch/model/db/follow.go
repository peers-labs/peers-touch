package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// Follow records that FollowerID follows FollowingID.
//
// Lives in `social` subserver but is kept here (not under social_* table
// family) because it is a generic relationship table reused by chat / oss /
// other subservers in the future. Table name stays `follows` for the same
// reason (no `social_` prefix).
type Follow struct {
	ID          uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	FollowerID  uint64    `gorm:"column:follower_id;uniqueIndex:idx_follower_following;index:idx_follower;not null"`
	FollowingID uint64    `gorm:"column:following_id;uniqueIndex:idx_follower_following;index:idx_following;not null"`
	CreatedAt   time.Time `gorm:"column:created_at;index"`

	Follower  *Actor `gorm:"foreignKey:FollowerID"`
	Following *Actor `gorm:"foreignKey:FollowingID"`
}

func (Follow) TableName() string { return "follows" }

func (f *Follow) BeforeCreate(tx *gorm.DB) error {
	if f.ID == 0 {
		f.ID = id.NextID()
	}
	return nil
}
