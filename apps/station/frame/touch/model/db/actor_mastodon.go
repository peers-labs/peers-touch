package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActorTouchMeta stores Peers-Touch extension fields and statistics
// Corresponds to "touch_actor_meta" table
type ActorTouchMeta struct {
	ActorID uint64 `gorm:"column:actor_id;primary_key;autoIncrement:false"` // Foreign key to Actor (1:1)
	// ProfileRevision covers editable profile/privacy fields only. Denormalized
	// counters and activity timestamps must not advance it.
	ProfileRevision uint64 `gorm:"column:profile_revision;default:1;not null"`

	// Extension Fields (TODO: Mastodon compatibility fields moved to todo)
	Discoverable              bool   `gorm:"column:discoverable;default:true"`
	ManuallyApprovesFollowers bool   `gorm:"column:manually_approves_followers;default:false"`
	Url                       string `gorm:"column:url;size:512"` // Profile URL (e.g. https://domain/@user)
	MovedToActorURI           string `gorm:"column:moved_to_actor_uri;size:512"`
	AlsoKnownAs               string `gorm:"column:also_known_as;type:text"` // JSON list of URIs

	// Statistics (Denormalized/Cached)
	FollowersCount int `gorm:"column:followers_count;default:0"`
	FollowingCount int `gorm:"column:following_count;default:0"`
	StatusesCount  int `gorm:"column:statuses_count;default:0"`

	// Extended Profile Fields (Peers-Touch specific)
	Region            string `gorm:"column:region;size:100"`
	Timezone          string `gorm:"column:timezone;size:50"`
	Tags              string `gorm:"column:tags;type:text"`                              // JSON list of strings (Feature tags)
	Links             string `gorm:"column:links;type:text"`                             // JSON list of UserLink objects
	DefaultVisibility string `gorm:"column:default_visibility;size:20;default:'public'"` // public, unlisted, followers, private
	MessagePermission string `gorm:"column:message_permission;size:20;default:'everyone'"`
	AutoExpireDays    int    `gorm:"column:auto_expire_days;default:0"`

	LastWebfingeredAt time.Time `gorm:"column:last_webfingered_at"`
	LastActivityAt    time.Time `gorm:"column:last_activity_at"`

	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*ActorTouchMeta) TableName() string {
	return "touch_actor_meta"
}

func (m *ActorTouchMeta) BeforeCreate(tx *gorm.DB) error {
	// ID is same as ActorID, which is manually set, but just in case
	if m.ActorID == 0 {
		m.ActorID = id.NextID() // Should be set from Actor
	}
	return nil
}
