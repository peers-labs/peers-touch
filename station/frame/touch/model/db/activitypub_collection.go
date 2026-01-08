package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubCollection represents a collection item relationship in the database
type ActivityPubCollection struct {
	ID             uint64    `gorm:"primary_key;autoIncrement:false"`                      // Snowflake ID
	ActorID        uint64    `gorm:"not null;index:idx_collection_actor_type"`             // Actor ID
	CollectionType string    `gorm:"size:20;not null;index:idx_collection_actor_type"`     // Collection type (inbox, outbox, followers, following, liked)
	ItemID         uint64    `gorm:"not null;index:idx_collection_item"`                   // Item numeric ID (Activity ID)
	ItemType       string    `gorm:"size:50;not null;index:idx_collection_item"`           // Item type (Activity, Actor, Object)
	Position       int64     `gorm:"index"`                                                // Position in ordered collections
	AddedAt        time.Time `gorm:"not null;index"`                                       // When item was added to collection

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubCollection) TableName() string {
	return "touch_ap_collection"
}

func (c *ActivityPubCollection) BeforeCreate(tx *gorm.DB) error {
	if c.ID == 0 {
		c.ID = id.NextID()
	}
	return nil
}
