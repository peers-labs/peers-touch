package db

import (
	"encoding/json"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	o "github.com/peers-labs/peers-touch/station/frame/object"
	"gorm.io/gorm"
)

// ActivityPubActivity represents an ActivityPub activity in the database
type ActivityPubActivity struct {
	ID            uint64    `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActivityPubID string    `gorm:"uniqueIndex;size:512;not null"`   // ActivityPub IRI
	Type          string    `gorm:"size:50;not null;index"`          // Activity type (Create, Follow, Like, etc.)
	ActorID       string    `gorm:"size:512;not null;index"`         // Actor who performed the activity
	ObjectID      string    `gorm:"size:512;index"`                  // Target object ID
	TargetID      string    `gorm:"size:512;index"`                  // Target collection/actor ID
	InReplyTo     string    `gorm:"size:512;index"`                  // Reply target ID (for efficient filtering)
	Text          string    `gorm:"type:text"`                       // Content text (for Note)
	Sensitive     bool      `gorm:"default:false"`                   // Sensitive content flag
	SpoilerText   string    `gorm:"type:text"`                       // Content warning text
	Visibility    string    `gorm:"size:50;index"`                   // Visibility (public, unlisted, private, direct)
	Language      string    `gorm:"size:10"`                         // Language code
	Published     time.Time `gorm:"not null;index"`                  // When the activity was published
	Content       string    `gorm:"type:json"`                       // Full activity JSON
	IsLocal       bool      `gorm:"default:false;not null;index"`    // Whether this is a local activity
	IsPublic      bool      `gorm:"default:true;not null;index"`     // Whether the activity is public

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubActivity) TableName() string {
	return "touch_ap_activity"
}

func (a *ActivityPubActivity) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}

// SetContent sets the activity content as JSON
func (a *ActivityPubActivity) SetContent(activity o.Activity) error {
	jsonData, err := json.Marshal(activity)
	if err != nil {
		return err
	}
	a.Content = string(jsonData)
	return nil
}

// GetContent gets the activity content from JSON
func (a *ActivityPubActivity) GetContent() (*o.Activity, error) {
	if a.Content == "" {
		return nil, nil
	}
	var activity o.Activity
	err := json.Unmarshal([]byte(a.Content), &activity)
	if err != nil {
		return nil, err
	}
	return &activity, nil
}
