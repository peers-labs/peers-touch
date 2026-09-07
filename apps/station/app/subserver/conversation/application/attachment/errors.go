package attachment

import (
	"errors"
	"fmt"
	"time"
)

// ErrorCode identifies a stable Conversation attachment failure class.
type ErrorCode string

const (
	ErrorCodeInvalidArgument ErrorCode = "CONVERSATION_ATTACHMENT_INVALID_ARGUMENT"
	ErrorCodeUnauthorized    ErrorCode = "CONVERSATION_ATTACHMENT_UNAUTHORIZED"
	ErrorCodeNotFound        ErrorCode = "CONVERSATION_ATTACHMENT_NOT_FOUND"
	ErrorCodeUploadExpired   ErrorCode = "CONVERSATION_ATTACHMENT_UPLOAD_EXPIRED"
	ErrorCodePartConflict    ErrorCode = "CONVERSATION_ATTACHMENT_PART_CONFLICT"
	ErrorCodeInvalidState    ErrorCode = "CONVERSATION_ATTACHMENT_INVALID_STATE"
	ErrorCodeNotGranted      ErrorCode = "CONVERSATION_ATTACHMENT_NOT_GRANTED"
	ErrorCodeETagMismatch    ErrorCode = "CONVERSATION_ATTACHMENT_ETAG_MISMATCH"
	ErrorCodeRangeInvalid    ErrorCode = "CONVERSATION_ATTACHMENT_RANGE_INVALID"
	ErrorCodeQuotaExceeded   ErrorCode = "CONVERSATION_ATTACHMENT_QUOTA_EXCEEDED"
	ErrorCodeIntegrityFailed ErrorCode = "CONVERSATION_ATTACHMENT_INTEGRITY_FAILED"
	ErrorCodePersistence     ErrorCode = "CONVERSATION_ATTACHMENT_PERSISTENCE_FAILURE"
	ErrorCodeRetryLater      ErrorCode = "CONVERSATION_ATTACHMENT_RETRY_LATER"
)

// Error carries operation context without embedding attachment bytes or private metadata.
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
	var attachmentError *Error
	if errors.As(err, &attachmentError) {
		return attachmentError.Code
	}

	return ""
}

func RetryAfterOf(err error) time.Duration {
	var attachmentError *Error
	if errors.As(err, &attachmentError) {
		return attachmentError.RetryAfter
	}

	return 0
}

func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}
