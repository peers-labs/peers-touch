package session

import "errors"

var (
	ErrSessionNotFound       = errors.New("session not found")
	ErrSessionExpired        = errors.New("session expired")
	ErrSessionRevoked        = errors.New("session revoked")
	ErrSessionDeviceConflict = errors.New("session is bound to another device")
)
