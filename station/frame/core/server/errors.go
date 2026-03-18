package server

import (
	"fmt"
	"net/http"
)

// HandlerError represents an error that can be returned from typed handlers
// It includes HTTP status code and error message
type HandlerError struct {
	Code    int
	Message string
	Err     error
}

func (e *HandlerError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *HandlerError) Unwrap() error {
	return e.Err
}

// NewHandlerError creates a new HandlerError with given code and message
func NewHandlerError(code int, message string) *HandlerError {
	return &HandlerError{
		Code:    code,
		Message: message,
	}
}

// NewHandlerErrorWithCause creates a new HandlerError with underlying error
func NewHandlerErrorWithCause(code int, message string, err error) *HandlerError {
	return &HandlerError{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

// Common error constructors for convenience
func BadRequest(message string) *HandlerError {
	return NewHandlerError(http.StatusBadRequest, message)
}

func BadRequestWithCause(message string, err error) *HandlerError {
	return NewHandlerErrorWithCause(http.StatusBadRequest, message, err)
}

func Unauthorized(message string) *HandlerError {
	return NewHandlerError(http.StatusUnauthorized, message)
}

func Forbidden(message string) *HandlerError {
	return NewHandlerError(http.StatusForbidden, message)
}

func NotFound(message string) *HandlerError {
	return NewHandlerError(http.StatusNotFound, message)
}

func InternalError(message string) *HandlerError {
	return NewHandlerError(http.StatusInternalServerError, message)
}

func InternalErrorWithCause(message string, err error) *HandlerError {
	return NewHandlerErrorWithCause(http.StatusInternalServerError, message, err)
}
