package interaction

import (
	"errors"
	"fmt"
)

type ErrorCode string

const (
	ErrorCodeInvalidArgument     ErrorCode = "CONVERSATION_INTERACTION_INVALID_ARGUMENT"
	ErrorCodeUnauthorized        ErrorCode = "CONVERSATION_INTERACTION_UNAUTHORIZED"
	ErrorCodeStalePulse          ErrorCode = "CONVERSATION_INTERACTION_STALE_PULSE"
	ErrorCodeIdempotencyConflict ErrorCode = "CONVERSATION_INTERACTION_IDEMPOTENCY_CONFLICT"
	ErrorCodeQuotaExceeded       ErrorCode = "CONVERSATION_INTERACTION_QUOTA_EXCEEDED"
	ErrorCodeIntegrityFailed     ErrorCode = "CONVERSATION_INTERACTION_INTEGRITY_FAILED"
	ErrorCodePersistence         ErrorCode = "CONVERSATION_INTERACTION_PERSISTENCE_FAILURE"
)

type Error struct {
	Code      ErrorCode
	Operation string
	Field     string
	Message   string
	Cause     error
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
	var interactionError *Error
	if errors.As(err, &interactionError) {
		return interactionError.Code
	}

	return ""
}

func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}
