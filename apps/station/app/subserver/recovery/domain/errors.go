package domain

import (
	"errors"
	"fmt"
)

type ErrorCode string

const (
	ErrorCodeInvalidArgument   ErrorCode = "invalid_argument"
	ErrorCodeUnauthorized      ErrorCode = "unauthorized"
	ErrorCodeArchiveIntegrity  ErrorCode = "archive_integrity"
	ErrorCodeArchiveTooLarge   ErrorCode = "archive_too_large"
	ErrorCodeRevisionConflict  ErrorCode = "revision_conflict"
	ErrorCodeRevisionNotFound  ErrorCode = "revision_not_found"
	ErrorCodeDependencyFailure ErrorCode = "dependency_failure"
	ErrorCodePersistence       ErrorCode = "persistence_failure"
)

type Error struct {
	Code      ErrorCode
	Operation string
	Field     string
	Detail    string
	Cause     error
}

func (e *Error) Error() string {
	message := fmt.Sprintf("recovery %s: %s", e.Operation, e.Code)
	if e.Field != "" {
		message += " field=" + e.Field
	}
	if e.Detail != "" {
		message += ": " + e.Detail
	}
	if e.Cause != nil {
		message += ": " + e.Cause.Error()
	}
	return message
}

func (e *Error) Unwrap() error {
	return e.Cause
}

func NewError(code ErrorCode, operation string, field string, detail string) error {
	return &Error{
		Code:      code,
		Operation: operation,
		Field:     field,
		Detail:    detail,
	}
}

func WrapError(
	code ErrorCode,
	operation string,
	field string,
	detail string,
	cause error,
) error {
	return &Error{
		Code:      code,
		Operation: operation,
		Field:     field,
		Detail:    detail,
		Cause:     cause,
	}
}

func IsCode(err error, code ErrorCode) bool {
	var domainError *Error
	return errors.As(err, &domainError) && domainError.Code == code
}
