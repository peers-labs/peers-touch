package repository

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

var (
	ErrAuthorizationExists      = errors.New("authorization_exists")
	ErrAuthorizationNotFound    = errors.New("invalid_state")
	ErrAuthorizationConsumed    = errors.New("state_consumed")
	ErrAuthorizationExpired     = errors.New("state_expired")
	ErrCredentialNotFound       = errors.New("credential_not_found")
	ErrCredentialNotRefreshable = errors.New("credential_not_refreshable")
	ErrStorageConflict          = errors.New("oauth_storage_conflict")
	ErrStorageUnavailable       = errors.New("oauth_storage_unavailable")
	ErrRecordCorrupt            = errors.New("oauth_record_corrupt")
	ErrKeyUnavailable           = errors.New("oauth_key_unavailable")
)

type OAuthStore interface {
	CreateAuthorization(ctx context.Context, session entity.AuthSession) error
	FindAuthorization(ctx context.Context, state string) (*entity.AuthSession, error)
	CompleteAuthorization(ctx context.Context, completion entity.AuthorizationCompletion) (*entity.OAuthIdentity, error)
	RecordAuthorizationFailure(ctx context.Context, failure entity.AuthorizationFailure) error
	LoadCredential(ctx context.Context, identityID string) (*entity.OAuthCredential, error)
	LoadCredentialForRefresh(ctx context.Context, identityID, operationID string) (*entity.OAuthCredential, bool, error)
	ReplaceCredential(ctx context.Context, refresh entity.CredentialRefresh) (*entity.OAuthCredential, error)
	AdminSnapshot(ctx context.Context, limit int) (entity.AdminSnapshot, error)
}

type OAuthMaintenanceStore interface {
	RotateEncryption(ctx context.Context, limit int) (entity.RotationResult, error)
}
