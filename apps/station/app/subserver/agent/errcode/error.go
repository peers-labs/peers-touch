package errcode

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type Code string

const (
	AgentInvalidRequest            Code = "AGENT_4001"
	AgentUnauthorized              Code = "AGENT_4002"
	AgentNotFound                  Code = "AGENT_4004"
	AgentVersionConflict           Code = "AGENT_4009"
	AgentIdempotencyConflict       Code = "IDEMPOTENCY_CONFLICT"
	AgentInvalidSourceState        Code = "INVALID_SOURCE_STATE"
	AgentActiveDependency          Code = "ACTIVE_DEPENDENCY"
	AgentQueueFull                 Code = "ADMISSION_QUEUE_FULL"
	AgentAttachmentRejected        Code = "CONTEXT_ATTACHMENT_REJECTED"
	AgentToolApprovalDenied        Code = "TOOL_APPROVAL_DENIED"
	AgentToolApprovalExpired       Code = "TOOL_APPROVAL_EXPIRED"
	AgentToolBudgetExhausted       Code = "TOOL_LOOP_BUDGET_EXHAUSTED"
	AgentContextOverflow           Code = "CONTEXT_OVERFLOW"
	AgentLifecycleCancelled        Code = "LIFECYCLE_CANCELLED"
	AgentProviderCredentialMissing Code = "PROVIDER_CREDENTIAL_MISSING"
	AgentProviderFailed            Code = "AGENT_5001"
	AgentCompressionFailed         Code = "AGENT_5002"
	AgentDelegationFailed          Code = "AGENT_5003"
	AgentCredentialFailed          Code = "AGENT_5004"
	AgentProviderDisabled          Code = "AGENT_5005"
	AgentSecurityViolation         Code = "AGENT_4003"
	AgentInternal                  Code = "AGENT_5000"

	AgentCanvasSingleAgentNotReady Code = "AGENT_CANVAS_SINGLE_AGENT_NOT_READY"

	AgentCanvasSingleAgentNotReadyLocaleKey    = "agent.errors.canvasSingleAgentNotReady"
	AgentCanvasSingleAgentNotReadyRequiredGate = "agent-v2-kernel-foundation-e2e"
	AgentAttachmentRejectedLocaleKey           = "agent.errors.attachmentRejected"
	AgentToolApprovalDeniedLocaleKey           = "agent.errors.toolApprovalDenied"
	AgentToolApprovalExpiredLocaleKey          = "agent.errors.toolApprovalExpired"
	AgentToolBudgetExhaustedLocaleKey          = "agent.errors.toolLoopBudgetExhausted"
	AgentContextOverflowLocaleKey              = "agent.errors.contextOverflow"
	AgentLifecycleCancelledLocaleKey           = "agent.errors.lifecycleCancelled"
	AgentProviderCredentialMissingLocaleKey    = "agent.errors.providerCredentialMissing"
)

const AgentActiveMutationConflict Code = "ADMISSION_ACTIVE_MUTATION_CONFLICT"

const AgentActiveMutationConflictLocaleKey = "agent.errors.activeMutationConflict"

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

func NewAttachmentRejected(attachmentID, reasonCode string) *BizError {
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
			Details: map[string]string{
				"attachment_id": attachmentID,
				"reason_code":   reasonCode,
			},
		},
	}
}

func NewToolApprovalDeniedPayload(toolCallID, decisionID string) *model.ErrorPayload {
	return &model.ErrorPayload{
		Error:     AgentToolApprovalDeniedLocaleKey,
		ErrorType: string(AgentToolApprovalDenied),
		LocaleKey: AgentToolApprovalDeniedLocaleKey,
		Retryable: false,
		Terminal:  true,
		Details: map[string]string{
			"tool_call_id": toolCallID,
			"decision_id":  decisionID,
		},
	}
}

func NewToolApprovalExpiredPayload(decisionID string, expiresAt time.Time) *model.ErrorPayload {
	return &model.ErrorPayload{
		Error:     AgentToolApprovalExpiredLocaleKey,
		ErrorType: string(AgentToolApprovalExpired),
		LocaleKey: AgentToolApprovalExpiredLocaleKey,
		Retryable: true,
		Terminal:  true,
		Details: map[string]string{
			"decision_id": decisionID,
			"expires_at":  expiresAt.UTC().Format(time.RFC3339Nano),
		},
	}
}

func NewLifecycleCancelledPayload(resourceKind, resourceID string) *model.ErrorPayload {
	return &model.ErrorPayload{
		Error:     AgentLifecycleCancelledLocaleKey,
		ErrorType: string(AgentLifecycleCancelled),
		LocaleKey: AgentLifecycleCancelledLocaleKey,
		Retryable: false,
		Terminal:  true,
		Details: map[string]string{
			"resource_kind": resourceKind,
			"resource_id":   resourceID,
		},
	}
}

func NewContextOverflow(limitTokens, actualTokens uint64) *BizError {
	return &BizError{
		Code:       AgentContextOverflow,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    AgentContextOverflowLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentContextOverflowLocaleKey,
			ErrorType: string(AgentContextOverflow),
			LocaleKey: AgentContextOverflowLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"limit_tokens":  strconv.FormatUint(limitTokens, 10),
				"actual_tokens": strconv.FormatUint(actualTokens, 10),
			},
		},
	}
}

func NewProviderCredentialMissing(providerID string) *BizError {
	return &BizError{
		Code:       AgentProviderCredentialMissing,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    AgentProviderCredentialMissingLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentProviderCredentialMissingLocaleKey,
			ErrorType: string(AgentProviderCredentialMissing),
			LocaleKey: AgentProviderCredentialMissingLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"provider_id": providerID,
			},
		},
	}
}

func NewActiveMutationConflict(resourceID string, expectedRevision, actualRevision int64) *BizError {
	return &BizError{
		Code:       AgentActiveMutationConflict,
		HTTPStatus: http.StatusConflict,
		Message:    AgentActiveMutationConflictLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentActiveMutationConflictLocaleKey,
			ErrorType: string(AgentActiveMutationConflict),
			LocaleKey: AgentActiveMutationConflictLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"resource_id":       resourceID,
				"expected_revision": strconv.FormatInt(expectedRevision, 10),
				"actual_revision":   strconv.FormatInt(actualRevision, 10),
			},
		},
	}
}
