// Package domain — sentinel errors for the dashboard bounded context.
//
// Change History:
// - 2026-04-10: Initial implementation — all domain-level sentinel errors.
// - 2026-04-10: Refactored from flat package to DDD domain layer.
package domain

import "errors"

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrAdminDisabled      = errors.New("admin account is disabled")
	ErrSuperUserExpired   = errors.New("super user has been retired after first admin was created")
	ErrSessionNotFound    = errors.New("session not found")
	ErrSessionExpired     = errors.New("session expired")
	ErrSessionRevoked     = errors.New("session revoked")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrForbidden          = errors.New("forbidden: local access only")
	ErrDIDNotAllowed      = errors.New("DID not in allowed list")
)
