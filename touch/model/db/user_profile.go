package db

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/util/id"
	"gorm.io/gorm"
)

// Gender represents user gender options
type Gender string

const (
	GenderMale   Gender = "male"
	GenderFemale Gender = "female"
	GenderOther  Gender = "other"
)

// UserProfile represents user profile information
type UserProfile struct {
	ID           uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	UserID       uint64 `gorm:"uniqueIndex;not null"`            // Foreign key to User
	ProfilePhoto string `gorm:"size:500"`                        // URL or path to profile photo
	Gender       Gender `gorm:"size:10;default:'other'"`         // User gender
	Region       string `gorm:"size:100"`                        // User region/location
	Email        string `gorm:"size:255"`                        // User email (replaces phone)
	PeersID      string `gorm:"uniqueIndex;size:50;not null"`    // Unique peers ID
	WhatsUp      string `gorm:"size:1000"`                       // User status/what's up message

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*UserProfile) TableName() string {
	return "touch_user_profile"
}

func (up *UserProfile) BeforeCreate(tx *gorm.DB) error {
	if up.ID == 0 {
		up.ID = id.NextID()
	}
	return nil
}