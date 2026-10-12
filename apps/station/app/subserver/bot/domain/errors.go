package domain

import (
	"errors"
	"fmt"
)

// Typed error codes mirror the 10000s business range convention; the HTTP
// layer maps these to status codes.
const (
	CodeInvalidArgument = "BOT_INVALID_ARGUMENT"
	CodeNameConflict    = "BOT_NAME_CONFLICT"
	CodeNotFound        = "BOT_NOT_FOUND"
	CodeStateConflict   = "BOT_STATE_CONFLICT"
	CodeUnauthenticated = "BOT_UNAUTHENTICATED"
	CodeSecretNotSet    = "BOT_SECRET_NOT_SET"
	CodeScopeForbidden  = "BOT_SCOPE_NOT_ENABLED"
)

// Error is a typed bot-domain error carrying a stable code.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// NewError builds a typed bot-domain error.
func NewError(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// NewNotFound is the canonical registry lookup miss.
func NewNotFound(ref string) *Error {
	return NewError(CodeNotFound, "bot not found: %s", ref)
}

// AsError extracts a *domain.Error from an arbitrary error.
func AsError(err error) (*Error, bool) {
	if err == nil {
		return nil, false
	}
	var de *Error
	if errors.As(err, &de) {
		return de, true
	}
	return nil, false
}
