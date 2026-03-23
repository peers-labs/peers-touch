package errcode

import "fmt"

type Code string

const (
	AIChatInvalidRequest Code = "AI_CHAT_4001"
	AIChatUnauthorized   Code = "AI_CHAT_4002"
	AIChatNotFound       Code = "AI_CHAT_4004"
	AIChatProviderFailed Code = "AI_CHAT_5001"
	AIChatInternal       Code = "AI_CHAT_5000"
)

type BizError struct {
	Code       Code
	HTTPStatus int
	Message    string
	Cause      error
}

func (e *BizError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Cause)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func (e *BizError) Unwrap() error {
	return e.Cause
}

func New(code Code, httpStatus int, message string, cause error) *BizError {
	return &BizError{Code: code, HTTPStatus: httpStatus, Message: message, Cause: cause}
}
