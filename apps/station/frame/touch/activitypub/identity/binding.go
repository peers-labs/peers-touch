package identity

import "time"

// Binding represents a link between a core Identity and an external provider ID
type Binding struct {
	ID           uint64 `gorm:"primaryKey"`
	IdentityID   uint64 `gorm:"uniqueIndex:idx_identity_provider;not null"`
	Provider     string `gorm:"uniqueIndex:idx_identity_provider;size:32;not null"`
	ProviderID   string `gorm:"uniqueIndex;size:255;not null"`
	Status       string `gorm:"size:20;default:'active'"`
	Capabilities string `gorm:"type:json"`
	VerifiedAt   *time.Time
	CreatedAt    time.Time `gorm:"autoCreateTime"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"`
}

// Alias represents a human-readable alias for an identity
type Alias struct {
	ID         uint64 `gorm:"primaryKey"`
	IdentityID uint64 `gorm:"index;not null"`
	Alias      string `gorm:"uniqueIndex;size:255;not null"`
	Kind       string `gorm:"size:20;default:'readable'"`
	Preferred  bool   `gorm:"default:false"`
	CreatedAt  time.Time
}
