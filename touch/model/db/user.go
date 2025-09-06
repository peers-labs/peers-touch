package db

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/util/id"
	"gorm.io/gorm"
)

type User struct {
	ID           uint64 `gorm:"primary_key;autoIncrement:false"` // Internal identity - cannot be changed
	PeersUserID  string `gorm:"uniqueIndex;size:255"`            // Network identification ID
	Name         string `gorm:"size:100;not null"`               // User's display name
	Email        string `gorm:"uniqueIndex;size:255;not null"`   // Unique email address
	PasswordHash string `gorm:"size:128;not null"`               // bcrypt hashed password

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*User) TableName() string {
	return "touch_user"
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == 0 {
		u.ID = id.NextID()
	}
	return nil
}
