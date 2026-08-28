package errcode

import (
	"fmt"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type Code string

const (
	AgentInvalidRequest      Code = "AGENT_4001"
	AgentUnauthorized        Code = "AGENT_4002"
	AgentNotFound            Code = "AGENT_4004"
	AgentVersionConflict     Code = "AGENT_4009"
	AgentIdempotencyConflict Code = "IDEMPOTENCY_CONFLICT"
	AgentInvalidSourceState  Code = "INVALID_SOURCE_STATE"
	AgentActiveDependency    Code = "ACTIVE_DEPENDENCY"
	AgentQueueFull           Code = "ADMISSION_QUEUE_FULL"
	AgentAttachmentRejected  Code = "CONTEXT_ATTACHMENT_REJECTED"
	AgentProviderFailed      Code = "AGENT_5001"
	AgentCompressionFailed   Code = "AGENT_5002"
	AgentDelegationFailed    Code = "AGENT_5003"
	AgentCredentialFailed    Code = "AGENT_5004"
	AgentProviderDisabled    Code = "AGENT_5005"
	AgentSecurityViolation   Code = "AGENT_4003"
	AgentInternal            Code = "AGENT_5000"

	AgentCanvasSingleAgentNotReady Code = "AGENT_CANVAS_SINGLE_AGENT_NOT_READY"

	AgentCanvasSingleAgentNotReadyLocaleKey    = "agent.errors.canvasSingleAgentNotReady"
	AgentCanvasSingleAgentNotReadyRequiredGate = "agent-v2-kernel-foundation-e2e"
	AgentAttachmentRejectedLocaleKey           = "agent.errors.attachmentRejected"
)

type BizError struct {
	Code       Code
	HTTPStatus int
	Message    string
	Cause      error
	Payload    *model.ErrorPayload
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

func NewCanvasSingleAgentNotReady() *BizError {
	code := string(AgentCanvasSingleAgentNotReady)
	return &BizError{
		Code:       AgentCanvasSingleAgentNotReady,
		HTTPStatus: http.StatusConflict,
		Message:    AgentCanvasSingleAgentNotReadyLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentCanvasSingleAgentNotReadyLocaleKey,
			ErrorType: code,
			LocaleKey: AgentCanvasSingleAgentNotReadyLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"required_gate": AgentCanvasSingleAgentNotReadyRequiredGate,
			},
		},
	}
}

func NewAttachmentRejected(reasonCode string) *BizError {
	return &BizError{
		Code:       AgentAttachmentRejected,
		HTTPStatus: http.StatusBadRequest,
		Message:    AgentAttachmentRejectedLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentAttachmentRejectedLocaleKey,
			ErrorType: string(AgentAttachmentRejected),
			LocaleKey: AgentAttachmentRejectedLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details:   map[string]string{"reason_code": reasonCode},
		},
	}
}
