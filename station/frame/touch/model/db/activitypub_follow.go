package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubFollow represents a follow relationship in the database
type ActivityPubFollow struct {
	ID          uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	FollowerID  string `gorm:"size:512;not null;index"`         // Actor who is following
	FollowingID string `gorm:"size:512;not null;index"`         // Actor being followed
	ActivityID  string `gorm:"size:512;uniqueIndex"`            // Follow activity ID
	Accepted    bool   `gorm:"default:false;not null;index"`    // Whether the follow was accepted
	IsActive    bool   `gorm:"default:true;not null;index"`     // Whether the follow is still active

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubFollow) TableName() string {
	return "touch_ap_follow"
}

func (f *ActivityPubFollow) BeforeCreate(tx *gorm.DB) error {
	if f.ID == 0 {
		f.ID = id.NextID()
	}
	return nil
}
