package db

import (
	"time"
)

type OAuthClient struct {
	ID               uint      `gorm:"column:id;primaryKey"`
	Name             string    `gorm:"column:name;size:128"`
	ClientID         string    `gorm:"column:client_id;size:128;uniqueIndex"`
	ClientSecretHash string    `gorm:"column:client_secret_hash;size:256"`
	RedirectURI      string    `gorm:"column:redirect_uri;size:512"`
	Scopes           string    `gorm:"column:scopes;size:256"`
	CreatedAt        time.Time `gorm:"column:created_at"`
}

func (*OAuthClient) TableName() string { return "touch_oauth_clients" }

type OAuthAuthCode struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	CodeHash  string    `gorm:"column:code_hash;size:256;uniqueIndex"`
	ClientID  string    `gorm:"column:client_id;size:128;index"`
	UserID    string    `gorm:"column:user_id;size:128;index"`
	Scopes    string    `gorm:"column:scopes;size:256"`
	ExpiresAt time.Time `gorm:"column:expires_at"`
	Used      bool      `gorm:"column:used"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (*OAuthAuthCode) TableName() string { return "touch_oauth_auth_codes" }

type OAuthToken struct {
	ID               uint      `gorm:"column:id;primaryKey"`
	AccessTokenHash  string    `gorm:"column:access_token_hash;size:256;uniqueIndex"`
	RefreshTokenHash string    `gorm:"column:refresh_token_hash;size:256"`
	TokenType        string    `gorm:"column:token_type;size:32"`
	Scope            string    `gorm:"column:scope;size:256"`
	UserID           string    `gorm:"column:user_id;size:128;index"`
	ClientID         string    `gorm:"column:client_id;size:128;index"`
	CreatedAt        time.Time `gorm:"column:created_at"`
	ExpiresAt        time.Time `gorm:"column:expires_at"`
}

func (*OAuthToken) TableName() string { return "touch_oauth_tokens" }
