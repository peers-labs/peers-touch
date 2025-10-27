package db

import (
	"time"

	"github.com/peers-touch/peers-touch-go/core/util/id"
	"gorm.io/gorm"
)

type Actor struct {
	ID           uint64 `gorm:"primary_key;autoIncrement:false"` // Internal identity - cannot be changed
	PeersActorID string `gorm:"uniqueIndex;size:255"`            // Network identification ID
	Name         string `gorm:"size:100;not null"`               // Actor's display name
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
