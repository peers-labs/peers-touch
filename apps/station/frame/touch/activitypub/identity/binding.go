package identity

import "time"

// Binding represents a link between a core Identity and an external provider ID
type Binding struct {
	ID           uint64     `gorm:"column:id;primaryKey"`
	IdentityID   uint64     `gorm:"column:identity_id;uniqueIndex:idx_identity_provider;not null"`
	Provider     string     `gorm:"column:provider;uniqueIndex:idx_identity_provider;size:32;not null"`
	ProviderID   string     `gorm:"column:provider_id;uniqueIndex;size:255;not null"`
	Status       string     `gorm:"column:status;size:20;default:'active'"`
	Capabilities string     `gorm:"column:capabilities;type:json"`
	VerifiedAt   *time.Time `gorm:"column:verified_at"`
	CreatedAt    time.Time  `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;autoUpdateTime"`
}

func (*Binding) TableName() string { return "touch_identity_bindings" }

// Alias represents a human-readable alias for an identity
type Alias struct {
	ID         uint64    `gorm:"column:id;primaryKey"`
	IdentityID uint64    `gorm:"column:identity_id;index;not null"`
	Alias      string    `gorm:"column:alias;uniqueIndex;size:255;not null"`
	Kind       string    `gorm:"column:kind;size:20;default:'readable'"`
	Preferred  bool      `gorm:"column:preferred;default:false"`
	CreatedAt  time.Time `gorm:"column:created_at"`
}

func (*Alias) TableName() string { return "touch_identity_aliases" }
