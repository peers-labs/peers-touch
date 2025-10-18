package db

import (
	"time"

	"github.com/peers-touch/peers-touch-go/core/util/id"
	"github.com/peers-touch/peers-touch-go/vendors/activitypub"
	"gorm.io/gorm"
)

// Actor represents an ActivityPub actor with database-specific fields
// It embeds the standard ActivityPub Actor and adds database management fields
type Actor struct {
	// Embed the standard ActivityPub Actor
	activitypub.Actor

	// Database-specific fields
	InternalID   uint64 `json:"internal_id" gorm:"primary_key;autoIncrement:false"` // Internal database ID
	PeersActorID string `json:"peers_actor_id" gorm:"uniqueIndex;size:255"`         // Network identification ID
	Email        string `json:"email" gorm:"uniqueIndex;size:255;not null"`         // Unique email address
	PasswordHash string `json:"-" gorm:"size:128;not null"`                         // bcrypt hashed password
	IsLocal      bool   `json:"is_local" gorm:"default:true"`                       // Whether this actor is local to this instance
	IsActive     bool   `json:"is_active" gorm:"default:true"`                      // Whether this actor is active

	// Timestamps
	CreatedAt time.Time `json:"created_at" gorm:"created_at"`
	UpdatedAt time.Time `json:"updated_at" gorm:"updated_at"`
}

func (*Actor) TableName() string {
	return "touch_actor"
}

func (a *Actor) BeforeCreate(tx *gorm.DB) error {
	if a.InternalID == 0 {
		a.InternalID = id.NextID()
	}
	return nil
}

// GetInternalID returns the internal database ID
func (a *Actor) GetInternalID() uint64 {
	return a.InternalID
}

// SetMetadata sets the metadata for the ActivityPub actor
func (a *Actor) SetMetadata(metadata interface{}) error {
	// Implementation would serialize metadata to JSON string
	// For now, just return nil
	return nil
}
