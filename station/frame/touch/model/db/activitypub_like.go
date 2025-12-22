package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubLike represents a like relationship in the database
type ActivityPubLike struct {
	ID         uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActorID    string `gorm:"size:512;not null;index"`         // Actor who liked
	ObjectID   string `gorm:"size:512;not null;index"`         // Object being liked
	ActivityID string `gorm:"size:512;uniqueIndex"`            // Like activity ID
	IsActive   bool   `gorm:"default:true;not null;index"`     // Whether the like is still active

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
