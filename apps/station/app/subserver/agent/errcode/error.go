package errcode

import "fmt"

type Code string

const (
	AgentInvalidRequest    Code = "AGENT_4001"
	AgentUnauthorized      Code = "AGENT_4002"
	AgentNotFound          Code = "AGENT_4004"
	AgentProviderFailed    Code = "AGENT_5001"
	AgentCompressionFailed Code = "AGENT_5002"
	AgentDelegationFailed  Code = "AGENT_5003"
	AgentCredentialFailed  Code = "AGENT_5004"
	AgentSecurityViolation Code = "AGENT_4003" // Added: 2026-04-11 — sandbox / security constraint violation
	AgentInternal          Code = "AGENT_5000"
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

func (e *BizError) Unwrap() error { return e.Cause }

func New(code Code, httpStatus int, message string, cause error) *BizError {
	return &BizError{Code: code, HTTPStatus: httpStatus, Message: message, Cause: cause}
}
