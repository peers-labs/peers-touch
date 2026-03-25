package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type OAuth2IdentityBinding struct {
	ID             uint64 `gorm:"primaryKey;autoIncrement:false"`
	ActorID        uint64 `gorm:"index;not null"`
	ProviderID     string `gorm:"size:64;not null;uniqueIndex:idx_oauth2_provider_user,priority:1;index:idx_oauth2_actor_provider,priority:2"`
	ProviderUserID string `gorm:"size:255;not null;uniqueIndex:idx_oauth2_provider_user,priority:2;index:idx_oauth2_actor_provider,priority:3"`
	ProviderUnion  string `gorm:"size:255"`
	Username       string `gorm:"size:128"`
	DisplayName    string `gorm:"size:255"`
	AvatarURL      string `gorm:"size:512"`
	Email          string `gorm:"size:255"`
	IsPrimary      bool   `gorm:"not null;default:false;index:idx_oauth2_actor_provider,priority:1"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (*OAuth2IdentityBinding) TableName() string {
	return "touch_oauth2_identity_binding"
}

func (m *OAuth2IdentityBinding) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}

type OAuth2TokenState struct {
	ID               uint64 `gorm:"primaryKey;autoIncrement:false"`
	ActorID          uint64 `gorm:"index;not null"`
	ProviderID       string `gorm:"size:64;not null;uniqueIndex:idx_oauth2_token_actor_provider,priority:2"`
	AccessToken      string `gorm:"type:text"`
	RefreshToken     string `gorm:"type:text"`
	TokenType        string `gorm:"size:32"`
	Scope            string `gorm:"type:text"`
	ExpiresAt        time.Time
	RefreshExpiresAt *time.Time
	Status           string `gorm:"size:32;default:'active'"`
	LastRefreshAt    *time.Time
	LastError        string `gorm:"type:text"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (*OAuth2TokenState) TableName() string {
	return "touch_oauth2_token_state"
}

func (m *OAuth2TokenState) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}

type OAuth2ConnectionState struct {
	ID              uint64 `gorm:"primaryKey;autoIncrement:false"`
	ProviderID      string `gorm:"size:64;not null;uniqueIndex"`
	Name            string `gorm:"size:128"`
	Category        string `gorm:"size:64"`
	Status          string `gorm:"size:32;default:'ready'"`
	HasCredentials  bool   `gorm:"not null;default:false"`
	ConfigSource    string `gorm:"size:64"`
	LastError       string `gorm:"type:text"`
	LastValidatedAt *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (*OAuth2ConnectionState) TableName() string {
	return "touch_oauth2_connection_state"
}

func (m *OAuth2ConnectionState) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}
