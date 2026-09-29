package entity

import (
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

const (
	AuditAuthorizationStarted = "authorization_started"
	AuditLoginSucceeded       = "login_succeeded"
	AuditLoginFailed          = "login_failed"
	AuditCredentialRefreshed  = "credential_refreshed"
)

type ProviderIdentity struct {
	ProviderUserID string `json:"provider_user_id"`
	UnionID        string `json:"union_id,omitempty"`
	Username       string `json:"username,omitempty"`
	DisplayName    string `json:"display_name,omitempty"`
	AvatarURL      string `json:"avatar_url,omitempty"`
	Email          string `json:"email,omitempty"`
	EmailVerified  bool   `json:"email_verified"`
}

type TokenSet struct {
	AccessToken      string     `json:"access_token"`
	RefreshToken     string     `json:"refresh_token,omitempty"`
	TokenType        string     `json:"token_type,omitempty"`
	Scope            string     `json:"scope,omitempty"`
	ObtainedAt       time.Time  `json:"obtained_at"`
	AccessExpiresAt  *time.Time `json:"access_expires_at,omitempty"`
	RefreshExpiresAt *time.Time `json:"refresh_expires_at,omitempty"`
}

type AuthorizationGrant struct {
	Identity ProviderIdentity
	Tokens   TokenSet
}

type OAuthIdentity struct {
	SchemaVersion  int                  `json:"schema_version"`
	IdentityID     string               `json:"identity_id"`
	SiteID         string               `json:"site_id"`
	Provider       valueobject.Provider `json:"provider"`
	ProviderUserID string               `json:"provider_user_id"`
	UnionID        string               `json:"union_id,omitempty"`
	Username       string               `json:"username,omitempty"`
	DisplayName    string               `json:"display_name,omitempty"`
	AvatarURL      string               `json:"avatar_url,omitempty"`
	Email          string               `json:"email,omitempty"`
	EmailVerified  bool                 `json:"email_verified"`
	FirstLoginAt   time.Time            `json:"first_login_at"`
	LastLoginAt    time.Time            `json:"last_login_at"`
	LoginCount     uint64               `json:"login_count"`
}

type OAuthCredential struct {
	SchemaVersion          int                  `json:"schema_version"`
	IdentityID             string               `json:"identity_id"`
	SiteID                 string               `json:"site_id"`
	Provider               valueobject.Provider `json:"provider"`
	AccessToken            string               `json:"access_token"`
	RefreshToken           string               `json:"refresh_token,omitempty"`
	TokenType              string               `json:"token_type,omitempty"`
	Scope                  string               `json:"scope,omitempty"`
	ObtainedAt             time.Time            `json:"obtained_at"`
	AccessExpiresAt        *time.Time           `json:"access_expires_at,omitempty"`
	RefreshExpiresAt       *time.Time           `json:"refresh_expires_at,omitempty"`
	Generation             uint64               `json:"generation"`
	LastRefreshOperationID string               `json:"last_refresh_operation_id,omitempty"`
}

type AuditEvent struct {
	SchemaVersion   int                  `json:"schema_version"`
	EventID         string               `json:"event_id"`
	EventType       string               `json:"event_type"`
	OccurredAt      time.Time            `json:"occurred_at"`
	SiteID          string               `json:"site_id"`
	Provider        valueobject.Provider `json:"provider"`
	TransactionID   string               `json:"transaction_id"`
	IdentityID      string               `json:"identity_id,omitempty"`
	CodeFingerprint string               `json:"code_fingerprint,omitempty"`
	Result          string               `json:"result"`
	ErrorCode       string               `json:"error_code,omitempty"`
}

type AuthorizationCompletion struct {
	State           string
	CompletionID    string
	CodeFingerprint string
	Identity        ProviderIdentity
	Tokens          TokenSet
	CompletedAt     time.Time
}

type AuthorizationFailure struct {
	State           string
	Provider        valueobject.Provider
	CodeFingerprint string
	ErrorCode       string
	OccurredAt      time.Time
}

type CredentialRefresh struct {
	IdentityID  string
	OperationID string
	Tokens      TokenSet
	RefreshedAt time.Time
}

type AdminIdentity struct {
	IdentityID       string               `json:"identity_id"`
	SiteID           string               `json:"site_id"`
	Provider         valueobject.Provider `json:"provider"`
	Username         string               `json:"username,omitempty"`
	DisplayName      string               `json:"display_name,omitempty"`
	Email            string               `json:"email,omitempty"`
	EmailVerified    bool                 `json:"email_verified"`
	FirstLoginAt     time.Time            `json:"first_login_at"`
	LastLoginAt      time.Time            `json:"last_login_at"`
	LoginCount       uint64               `json:"login_count"`
	HasAccessToken   bool                 `json:"has_access_token"`
	HasRefreshToken  bool                 `json:"has_refresh_token"`
	AccessExpiresAt  *time.Time           `json:"access_expires_at,omitempty"`
	RefreshExpiresAt *time.Time           `json:"refresh_expires_at,omitempty"`
}

type AdminAuditEvent struct {
	EventID    string               `json:"event_id"`
	EventType  string               `json:"event_type"`
	OccurredAt time.Time            `json:"occurred_at"`
	SiteID     string               `json:"site_id"`
	Provider   valueobject.Provider `json:"provider"`
	IdentityID string               `json:"identity_id,omitempty"`
	Result     string               `json:"result"`
	ErrorCode  string               `json:"error_code,omitempty"`
}

type AdminSnapshot struct {
	GeneratedAt time.Time         `json:"generated_at"`
	Identities  []AdminIdentity   `json:"identities"`
	Events      []AdminAuditEvent `json:"events"`
}

type RotationResult struct {
	Scanned   int `json:"scanned"`
	Rotated   int `json:"rotated"`
	Unchanged int `json:"unchanged"`
	Failed    int `json:"failed"`
}
