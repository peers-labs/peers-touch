package model

import (
	"time"
)

// Identity represents the core identity of a user/entity
type Identity struct {
	ID          uint64    `gorm:"primaryKey"`
	PTID        string    `gorm:"uniqueIndex;size:255;not null"`
	Username    string    `gorm:"index;size:32;not null"`
	Namespace   string    `gorm:"index;size:64;not null"`
	Type        string    `gorm:"size:2;not null"` // p, g, o, s, a
	Fingerprint string    `gorm:"size:255;not null"`
	Version     string    `gorm:"size:10;default:'v1'"`
	Status      string    `gorm:"size:20;default:'active'"`
	CreatedAt   time.Time `gorm:"autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}

// Key represents a cryptographic key associated with an identity
type Key struct {
	ID         uint64    `gorm:"primaryKey"`
	IdentityID uint64    `gorm:"index;not null"`
	PublicKey  []byte    `gorm:"not null"`
	Algorithm  string    `gorm:"size:32;not null"` // e.g., Ed25519
	IsMaster   bool      `gorm:"default:false"`    // Is this the master key used for fingerprint?
	CreatedAt  time.Time `gorm:"autoCreateTime"`
	RevokedAt  *time.Time
}
