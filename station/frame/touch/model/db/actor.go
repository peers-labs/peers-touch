package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type Actor struct {
	ID           uint64 `gorm:"primary_key;autoIncrement:false"` // Internal identity - cannot be changed
	PeersActorID string `gorm:"uniqueIndex;size:255"`            // Network identification ID (PTID)
	Namespace    string `gorm:"size:64;default:'peers';not null;uniqueIndex:idx_actor_name_namespace"` // Namespace for the actor name
	Name         string `gorm:"size:100;not null;uniqueIndex:idx_actor_name_namespace"`                // Actor's unique handle within namespace (PreferredUsername)
	DisplayName  string `gorm:"size:100"`                        // Actor's display name
	Type         string `gorm:"size:32;default:'Person'"`        // ActivityPub Actor type
	Summary      string `gorm:"type:text"`                       // Bio/Summary
	Icon         string `gorm:"size:512"`                        // Avatar URL
	Image        string `gorm:"size:512"`                        // Header Image URL
	Email        string `gorm:"uniqueIndex;size:255;not null"`   // Unique email address
	PasswordHash string `gorm:"size:128;not null"`               // bcrypt hashed password

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*Actor) TableName() string {
	return "touch_actor"
}

func (a *Actor) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}
