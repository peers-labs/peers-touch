package securecontent

import (
	"errors"
	"fmt"
	"time"
)

// ErrorCode identifies a domain-neutral Secure Content validation failure.
type ErrorCode string

const (
	ErrorCodeInvalidArgument    ErrorCode = "SECURE_CONTENT_INVALID_ARGUMENT"
	ErrorCodeUnsupportedVersion ErrorCode = "SECURE_CONTENT_UNSUPPORTED_VERSION"
	ErrorCodeBindingMismatch    ErrorCode = "SECURE_CONTENT_BINDING_MISMATCH"
	ErrorCodeInvalidState       ErrorCode = "SECURE_CONTENT_INVALID_STATE"
	ErrorCodeConflict           ErrorCode = "SECURE_CONTENT_CONFLICT"
	ErrorCodeExpired            ErrorCode = "SECURE_CONTENT_EXPIRED"
	ErrorCodeRangeInvalid       ErrorCode = "SECURE_CONTENT_RANGE_INVALID"
	ErrorCodeQuotaExceeded      ErrorCode = "SECURE_CONTENT_QUOTA_EXCEEDED"
	ErrorCodeIntegrityFailed    ErrorCode = "SECURE_CONTENT_INTEGRITY_FAILED"
	ErrorCodeRetryLater         ErrorCode = "SECURE_CONTENT_RETRY_LATER"
)

// Error carries bounded operation context without secret-bearing values.
type Error struct {
	Code       ErrorCode
	Operation  string
	Field      string
	Message    string
	RetryAfter time.Duration
	Cause      error
}

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

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}

	return e.Cause
}

func NewError(code ErrorCode, operation string, field string, message string) error {
	return &Error{
		Code:      code,
		Operation: operation,
		Field:     field,
		Message:   message,
	}
}

func NewRetryError(operation string, retryAfter time.Duration, message string) error {
	return &Error{
		Code:       ErrorCodeRetryLater,
		Operation:  operation,
		Message:    message,
		RetryAfter: retryAfter,
	}
}

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

func CodeOf(err error) ErrorCode {
	var secureContentError *Error
	if errors.As(err, &secureContentError) {
		return secureContentError.Code
	}

	return ""
}

func RetryAfterOf(err error) time.Duration {
	var secureContentError *Error
	if errors.As(err, &secureContentError) {
		return secureContentError.RetryAfter
	}

	return 0
}

func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}
