package delivery

import (
	"errors"
	"fmt"
)

// ErrorCode identifies a stable Device Inbox failure class.
type ErrorCode string

const (
	ErrorCodeInvalidArgument     ErrorCode = "DEVICE_INBOX_INVALID_ARGUMENT"
	ErrorCodeUnauthorized        ErrorCode = "DEVICE_INBOX_UNAUTHORIZED"
	ErrorCodeConsumerFenced      ErrorCode = "DEVICE_INBOX_CONSUMER_FENCED"
	ErrorCodeItemNotFound        ErrorCode = "DEVICE_INBOX_ITEM_NOT_FOUND"
	ErrorCodeItemOwnerMismatch   ErrorCode = "DEVICE_INBOX_ITEM_OWNER_MISMATCH"
	ErrorCodeItemNotHead         ErrorCode = "DEVICE_INBOX_ITEM_NOT_HEAD"
	ErrorCodeItemNotClaimed      ErrorCode = "DEVICE_INBOX_ITEM_NOT_CLAIMED"
	ErrorCodePayloadHashMismatch ErrorCode = "DEVICE_INBOX_PAYLOAD_HASH_MISMATCH"
	ErrorCodeQuotaExceeded       ErrorCode = "DEVICE_INBOX_QUOTA_EXCEEDED"
	ErrorCodeIdempotencyConflict ErrorCode = "DEVICE_INBOX_IDEMPOTENCY_CONFLICT"
	ErrorCodeLeaseExpired        ErrorCode = "DEVICE_INBOX_LEASE_EXPIRED"
	ErrorCodePersistence         ErrorCode = "DEVICE_INBOX_PERSISTENCE_FAILURE"
)

// Error carries a machine-readable code and operation context.
type Error struct {
	Code      ErrorCode
	Operation string
	Field     string
	Message   string
	Cause     error
}

// Error formats the stable operation context without exposing payload data.
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

// Unwrap exposes the persistence or integration cause for diagnostics.
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}

	return e.Cause
}

// NewError creates a Device Inbox error without an underlying cause.
func NewError(code ErrorCode, operation string, field string, message string) error {
	return &Error{
		Code:      code,
		Operation: operation,
		Field:     field,
		Message:   message,
	}
}

// WrapError preserves a cause while assigning a stable Device Inbox error code.
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

// CodeOf returns the first Device Inbox code in an error chain.
func CodeOf(err error) ErrorCode {
	var deliveryError *Error
	if errors.As(err, &deliveryError) {
		return deliveryError.Code
	}

	return ""
}

// IsCode reports whether an error chain contains the requested Device Inbox code.
func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}
