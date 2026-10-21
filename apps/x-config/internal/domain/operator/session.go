package operator

import (
	"context"
	"errors"
	"time"
)

var (
	ErrAttemptExists       = errors.New("operator_attempt_exists")
	ErrAttemptNotFound     = errors.New("operator_attempt_not_found")
	ErrAttemptConsumed     = errors.New("operator_attempt_consumed")
	ErrAttemptExpired      = errors.New("operator_attempt_expired")
	ErrAssertionReplay     = errors.New("operator_assertion_replayed")
	ErrSessionNotFound     = errors.New("operator_session_not_found")
	ErrSessionExpired      = errors.New("operator_session_expired")
	ErrSessionRevoked      = errors.New("operator_session_revoked")
	ErrCSRFInvalid         = errors.New("operator_csrf_invalid")
	ErrUnauthorizedSubject = errors.New("operator_subject_unauthorized")
	ErrConflict            = errors.New("operator_store_conflict")
	ErrUnavailable         = errors.New("operator_store_unavailable")
	ErrCorrupt             = errors.New("operator_store_corrupt")
)

type LoginAttempt struct {
	SchemaVersion    int        `json:"schema_version"`
	AttemptID        string     `json:"attempt_id"`
	ReceiverVerifier []byte     `json:"receiver_verifier"`
	CreatedAt        time.Time  `json:"created_at"`
	ExpiresAt        time.Time  `json:"expires_at"`
	ConsumedAt       *time.Time `json:"consumed_at,omitempty"`
}

type Session struct {
	SchemaVersion   int        `json:"schema_version"`
	SessionID       string     `json:"session_id"`
	TokenDigest     []byte     `json:"token_digest"`
	CSRFDigest      []byte     `json:"csrf_digest"`
	Provider        string     `json:"provider"`
	ProviderSubject string     `json:"provider_subject"`
	AssertionID     string     `json:"assertion_id"`
	IssuedAt        time.Time  `json:"issued_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
}

type Store interface {
	CreateAttempt(ctx context.Context, attempt LoginAttempt) error
	FindAttempt(
		ctx context.Context,
		attemptID string,
		now time.Time,
	) (*LoginAttempt, error)
	CompleteLogin(
		ctx context.Context,
		attemptID string,
		assertionDigest []byte,
		session Session,
	) error
	FindSession(
		ctx context.Context,
		tokenDigest []byte,
		now time.Time,
	) (*Session, error)
	RevokeSession(
		ctx context.Context,
		tokenDigest []byte,
		now time.Time,
	) error
}
