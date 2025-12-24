package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubFollow represents a follow relationship in the database
type ActivityPubFollow struct {
    ID          uint64 `gorm:"primary_key;autoIncrement:false"`
    FollowerID  uint64 `gorm:"index"`
    FollowingID uint64 `gorm:"index"`
    ActivityID  uint64 `gorm:"index"`
    Accepted    bool   `gorm:"default:false;not null;index"`
    IsActive    bool   `gorm:"default:true;not null;index"`

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
