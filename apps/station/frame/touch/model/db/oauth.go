package db

import (
	"time"
)

type OAuthClient struct {
	ID               uint   `gorm:"primaryKey"`
	Name             string `gorm:"size:128"`
	ClientID         string `gorm:"size:128;uniqueIndex"`
	ClientSecretHash string `gorm:"size:256"`
	RedirectURI      string `gorm:"size:512"`
	Scopes           string `gorm:"size:256"`
	CreatedAt        time.Time
}

type OAuthAuthCode struct {
	ID        uint   `gorm:"primaryKey"`
	CodeHash  string `gorm:"size:256;uniqueIndex"`
	ClientID  string `gorm:"size:128;index"`
	UserID    string `gorm:"size:128;index"`
	Scopes    string `gorm:"size:256"`
	ExpiresAt time.Time
	Used      bool
	CreatedAt time.Time
}

type OAuthToken struct {
	ID               uint   `gorm:"primaryKey"`
	AccessTokenHash  string `gorm:"size:256;uniqueIndex"`
	RefreshTokenHash string `gorm:"size:256"`
	TokenType        string `gorm:"size:32"`
	Scope            string `gorm:"size:256"`
	UserID           string `gorm:"size:128;index"`
	ClientID         string `gorm:"size:128;index"`
	CreatedAt        time.Time
	ExpiresAt        time.Time
}
