package domain

import (
	"errors"
	"fmt"
)

// ErrorCode identifies a stable Actor Identity failure class.
type ErrorCode string

const (
	ErrorCodeInvalidArgument      ErrorCode = "ACTOR_IDENTITY_INVALID_ARGUMENT"
	ErrorCodeUnauthorized         ErrorCode = "ACTOR_IDENTITY_UNAUTHORIZED"
	ErrorCodeInvalidProof         ErrorCode = "ACTOR_IDENTITY_INVALID_PROOF"
	ErrorCodeIdentityConflict     ErrorCode = "ACTOR_IDENTITY_CONTINUITY_CONFLICT"
	ErrorCodeDeviceConflict       ErrorCode = "ACTOR_IDENTITY_DEVICE_CONFLICT"
	ErrorCodeStaleProfileVersion  ErrorCode = "ACTOR_IDENTITY_STALE_PROFILE_VERSION"
	ErrorCodeFutureProfileVersion ErrorCode = "ACTOR_IDENTITY_FUTURE_PROFILE_VERSION"
	ErrorCodeDeviceNotFound       ErrorCode = "ACTOR_IDENTITY_DEVICE_NOT_FOUND"
	ErrorCodeDeviceRevoked        ErrorCode = "ACTOR_IDENTITY_DEVICE_REVOKED"
	ErrorCodeIdentityUnavailable  ErrorCode = "ACTOR_IDENTITY_UNAVAILABLE"
	ErrorCodePersistence          ErrorCode = "ACTOR_IDENTITY_PERSISTENCE_FAILURE"
)

// Error carries a typed failure without coupling the domain to HTTP.
type Error struct {
	Code      ErrorCode
	Operation string
	Field     string
	Message   string
	Cause     error
}

// Error returns a context-rich description without exposing key material.
func (e *Error) Error() string {
	switch {
	case e == nil:
		return ""
	case e.Field != "":
		return fmt.Sprintf("%s: %s: %s", e.Operation, e.Field, e.Message)
	case e.Operation != "":
		return fmt.Sprintf("%s: %s", e.Operation, e.Message)
	default:
		return e.Message
	}
}

// Unwrap exposes the persistence cause for diagnostics and errors.Is checks.
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}

	return e.Cause
}

// NewError creates a typed Actor Identity error.
func NewError(code ErrorCode, operation string, field string, message string) error {
	return &Error{
		Code:      code,
		Operation: operation,
		Field:     field,
		Message:   message,
	}
}

// WrapError adds an Actor Identity code and operation to an infrastructure failure.
func WrapError(code ErrorCode, operation string, cause error) error {
	if cause == nil {
		return nil
	}

	return &Error{
		Code:      code,
		Operation: operation,
		Message:   cause.Error(),
		Cause:     cause,
	}
}

// IsCode reports whether err contains the requested Actor Identity code.
func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}

// CodeOf extracts the Actor Identity code from an error chain.
func CodeOf(err error) ErrorCode {
	var domainError *Error
	if errors.As(err, &domainError) {
		return domainError.Code
	}

	return ""
}
