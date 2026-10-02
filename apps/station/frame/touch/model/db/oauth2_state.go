package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type OAuth2IdentityBinding struct {
	ID             uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	ActorID        uint64    `gorm:"column:actor_id;index;not null"`
	ProviderID     string    `gorm:"column:provider_id;size:64;not null;uniqueIndex:idx_oauth2_provider_user,priority:1;index:idx_oauth2_actor_provider,priority:2"`
	ProviderUserID string    `gorm:"column:provider_user_id;size:255;not null;uniqueIndex:idx_oauth2_provider_user,priority:2;index:idx_oauth2_actor_provider,priority:3"`
	ProviderUnion  string    `gorm:"column:provider_union;size:255"`
	Username       string    `gorm:"column:username;size:128"`
	DisplayName    string    `gorm:"column:display_name;size:255"`
	AvatarURL      string    `gorm:"column:avatar_url;size:512"`
	Email          string    `gorm:"column:email;size:255"`
	EmailVerified  bool      `gorm:"column:email_verified;not null;default:false"`
	IsPrimary      bool      `gorm:"column:is_primary;not null;default:false;index:idx_oauth2_actor_provider,priority:1"`
	CreatedAt      time.Time `gorm:"column:created_at"`
	UpdatedAt      time.Time `gorm:"column:updated_at"`
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
	ID               uint64     `gorm:"column:id;primaryKey;autoIncrement:false"`
	ActorID          uint64     `gorm:"column:actor_id;index;not null"`
	ProviderID       string     `gorm:"column:provider_id;size:64;not null;uniqueIndex:idx_oauth2_token_actor_provider,priority:2"`
	AccessToken      string     `gorm:"column:access_token;type:text"`
	RefreshToken     string     `gorm:"column:refresh_token;type:text"`
	TokenType        string     `gorm:"column:token_type;size:32"`
	Scope            string     `gorm:"column:scope;type:text"`
	ExpiresAt        time.Time  `gorm:"column:expires_at"`
	RefreshExpiresAt *time.Time `gorm:"column:refresh_expires_at"`
	Status           string     `gorm:"column:status;size:32;default:'active'"`
	LastRefreshAt    *time.Time `gorm:"column:last_refresh_at"`
	LastError        string     `gorm:"column:last_error;type:text"`
	CreatedAt        time.Time  `gorm:"column:created_at"`
	UpdatedAt        time.Time  `gorm:"column:updated_at"`
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
	ID              uint64     `gorm:"column:id;primaryKey;autoIncrement:false"`
	ProviderID      string     `gorm:"column:provider_id;size:64;not null;uniqueIndex"`
	Name            string     `gorm:"column:name;size:128"`
	Category        string     `gorm:"column:category;size:64"`
	Status          string     `gorm:"column:status;size:32;default:'ready'"`
	HasCredentials  bool       `gorm:"column:has_credentials;not null;default:false"`
	ConfigSource    string     `gorm:"column:config_source;size:64"`
	LastError       string     `gorm:"column:last_error;type:text"`
	LastValidatedAt *time.Time `gorm:"column:last_validated_at"`
	CreatedAt       time.Time  `gorm:"column:created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at"`
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

// OAuthBridgeAssertion records one consumed broker assertion. ID is a SHA-256
// digest of the signed assertion identifier; the bearer value is never stored.
type OAuthBridgeAssertion struct {
	ID         string    `gorm:"column:id;primaryKey;size:64"`
	Purpose    string    `gorm:"column:purpose;size:32;not null"`
	ConsumedAt time.Time `gorm:"column:consumed_at;not null"`
	ExpiresAt  time.Time `gorm:"column:expires_at;not null;index"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (*OAuthBridgeAssertion) TableName() string {
	return "touch_oauth_bridge_assertion"
}
