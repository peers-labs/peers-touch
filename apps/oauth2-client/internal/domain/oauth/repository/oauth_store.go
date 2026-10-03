package repository

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

var (
	ErrAuthorizationExists        = errors.New("authorization_exists")
	ErrAuthorizationNotFound      = errors.New("invalid_state")
	ErrAuthorizationConsumed      = errors.New("state_consumed")
	ErrAuthorizationExpired       = errors.New("state_expired")
	ErrCredentialNotFound         = errors.New("credential_not_found")
	ErrCredentialNotRefreshable   = errors.New("credential_not_refreshable")
	ErrCredentialRefreshUncertain = errors.New("credential_refresh_uncertain")
	ErrStorageConflict            = errors.New("oauth_storage_conflict")
	ErrStorageUnavailable         = errors.New("oauth_storage_unavailable")
	ErrRecordCorrupt              = errors.New("oauth_record_corrupt")
	ErrKeyUnavailable             = errors.New("oauth_key_unavailable")
)

type OAuthStore interface {
	CreateAuthorization(ctx context.Context, session entity.AuthSession) error
	FindAuthorization(ctx context.Context, state string) (*entity.AuthSession, error)
	CompleteAuthorization(ctx context.Context, completion entity.AuthorizationCompletion) (*entity.OAuthIdentity, error)
	RecordAuthorizationFailure(ctx context.Context, failure entity.AuthorizationFailure) error
	LoadCredential(ctx context.Context, identityID string) (*entity.OAuthCredential, error)
	ClaimCredentialRefresh(ctx context.Context, identityID, operationID string, claimedAt time.Time) (*entity.CredentialRefreshClaim, error)
	ReleaseCredentialRefreshClaim(ctx context.Context, claim entity.CredentialRefreshClaim) error
	ReplaceCredential(ctx context.Context, refresh entity.CredentialRefresh) (*entity.OAuthCredential, error)
	MarkCredentialRefreshUncertain(ctx context.Context, claim entity.CredentialRefreshClaim, errorCode string, occurredAt time.Time) error
	AdminSnapshot(ctx context.Context, limit int) (entity.AdminSnapshot, error)
}

type OAuthMaintenanceStore interface {
	RotateEncryption(ctx context.Context, limit int) (entity.RotationResult, error)
}
