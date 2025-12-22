package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActorMastodonMeta stores Mastodon-compatible extension fields and statistics
// Corresponds to Phase 2 "touch_actor_mastodon_meta" table
type ActorMastodonMeta struct {
	ActorID uint64 `gorm:"primary_key;autoIncrement:false"` // Foreign key to Actor (1:1)

	// Extension Fields
	Discoverable              bool   `gorm:"default:true"`
	ManuallyApprovesFollowers bool   `gorm:"default:false"`
	Url                       string `gorm:"size:512"` // Profile URL (e.g. https://domain/@user)
	MovedToActorURI           string `gorm:"size:512"`
	AlsoKnownAs               string `gorm:"type:text"` // JSON list of URIs

	// Statistics (Denormalized/Cached)
	FollowersCount int `gorm:"default:0"`
	FollowingCount int `gorm:"default:0"`
	StatusesCount  int `gorm:"default:0"`

	// Extended Profile Fields (Peers-Touch specific or extra extensions)
	Region            string `gorm:"size:100"`
	Timezone          string `gorm:"size:50"`
	Tags              string `gorm:"type:text"`                // JSON list of strings (Feature tags)
	Links             string `gorm:"type:text"`                // JSON list of UserLink objects
	DefaultVisibility string `gorm:"size:20;default:'public'"` // public, unlisted, followers, private
	MessagePermission string `gorm:"size:20;default:'everyone'"`
	AutoExpireDays    int    `gorm:"default:0"`

	LastWebfingeredAt time.Time
	LastActivityAt    time.Time

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActorMastodonMeta) TableName() string {
	return "touch_actor_mastodon_meta"
}

func (m *ActorMastodonMeta) BeforeCreate(tx *gorm.DB) error {
	// ID is same as ActorID, which is manually set, but just in case
	if m.ActorID == 0 {
		m.ActorID = id.NextID() // Should be set from Actor
	}
	return nil
}
