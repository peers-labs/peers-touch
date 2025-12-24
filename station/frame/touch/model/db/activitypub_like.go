package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubLike represents a like relationship in the database
type ActivityPubLike struct {
    ID         uint64 `gorm:"primary_key;autoIncrement:false"`
    ActorID    uint64 `gorm:"index"`
    ObjectID   uint64 `gorm:"index"`
    ActivityID uint64 `gorm:"index"`
    IsActive   bool   `gorm:"default:true;not null;index"`

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubLike) TableName() string {
	return "touch_ap_like"
}

func (l *ActivityPubLike) BeforeCreate(tx *gorm.DB) error {
	if l.ID == 0 {
		l.ID = id.NextID()
	}
	return nil
}
