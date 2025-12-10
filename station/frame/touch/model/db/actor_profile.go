package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// Gender represents actor gender options
type Gender string

const (
	GenderMale   Gender = "male"
	GenderFemale Gender = "female"
	GenderOther  Gender = "other"
)

// ActorProfile represents actor profile information
type ActorProfile struct {
	ID           uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActorID      uint64 `gorm:"uniqueIndex;not null"`            // Foreign key to Actor
	ProfilePhoto string `gorm:"size:500"`                        // URL or path to profile photo
	Gender       Gender `gorm:"size:10;default:'other'"`         // Actor gender
	Region       string `gorm:"size:100"`                        // Actor region/location
	Email        string `gorm:"size:255"`                        // Actor email (replaces phone)
	PeersID      string `gorm:"uniqueIndex;size:50;not null"`    // Unique peers ID
	WhatsUp      string `gorm:"size:1000"`                       // Actor status/what's up message


	// Extended Profile Fields
	Timezone                  string `gorm:"size:50"`
	Tags                      string `gorm:"type:text"`                        // JSON list of strings
	Links                     string `gorm:"type:text"`                        // JSON list of UserLink objects
	DefaultVisibility         string `gorm:"size:20;default:'public'"`         // public, unlisted, followers, private
	ManuallyApprovesFollowers bool   `gorm:"default:false"`                    // Whether to manually approve followers
	MessagePermission         string `gorm:"size:20;default:'everyone'"`       // everyone, mutual, none
	AutoExpireDays            int    `gorm:"default:0"`                        // Auto expire days for posts

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActorProfile) TableName() string {
	return "touch_actor_profile"
}

func (ap *ActorProfile) BeforeCreate(tx *gorm.DB) error {
	if ap.ID == 0 {
		ap.ID = id.NextID()
	}
	return nil
}
