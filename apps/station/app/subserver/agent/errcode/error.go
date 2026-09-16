package errcode

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type Code string

const (
	AgentInvalidRequest                Code = "AGENT_4001"
	AgentUnauthorized                  Code = "AGENT_4002"
	AgentNotFound                      Code = "AGENT_4004"
	AgentVersionConflict               Code = "AGENT_4009"
	AgentIdempotencyConflict           Code = "IDEMPOTENCY_CONFLICT"
	AgentInvalidSourceState            Code = "INVALID_SOURCE_STATE"
	AgentActiveDependency              Code = "ACTIVE_DEPENDENCY"
	AgentOwnershipForbiddenActor       Code = "OWNERSHIP_FORBIDDEN_ACTOR"
	AgentQueueFull                     Code = "ADMISSION_QUEUE_FULL"
	AgentAttachmentRejected            Code = "CONTEXT_ATTACHMENT_REJECTED"
	AgentRuntimeIncompatibleCapability Code = "RUNTIME_INCOMPATIBLE_CAPABILITY"
	AgentToolApprovalDenied            Code = "TOOL_APPROVAL_DENIED"
	AgentToolApprovalExpired           Code = "TOOL_APPROVAL_EXPIRED"
	AgentClientExecutorUnavailable     Code = "CLIENT_EXECUTOR_UNAVAILABLE"
	AgentToolBudgetExhausted           Code = "TOOL_LOOP_BUDGET_EXHAUSTED"
	AgentContextOverflow               Code = "CONTEXT_OVERFLOW"
	AgentContextInvalidReference       Code = "CONTEXT_INVALID_REFERENCE"
	AgentLifecycleCancelled            Code = "LIFECYCLE_CANCELLED"
	AgentLifecycleInterrupted          Code = "LIFECYCLE_INTERRUPTED"
	AgentProviderCredentialMissing     Code = "PROVIDER_CREDENTIAL_MISSING"
	AgentProviderFailed                Code = "AGENT_5001"
	AgentCompressionFailed             Code = "AGENT_5002"
	AgentDelegationFailed              Code = "AGENT_5003"
	AgentCredentialFailed              Code = "AGENT_5004"
	AgentProviderDisabled              Code = "AGENT_5005"
	AgentSecurityViolation             Code = "AGENT_4003"
	AgentInternal                      Code = "AGENT_5000"

	AgentAdmissionDuplicateConflict Code = "ADMISSION_DUPLICATE_CONFLICT"
	AgentCanvasSingleAgentNotReady  Code = "AGENT_CANVAS_SINGLE_AGENT_NOT_READY"

	AgentAdmissionDuplicateConflictLocaleKey    = "agent.errors.duplicateConflict"
	AgentCanvasSingleAgentNotReadyLocaleKey     = "agent.errors.canvasSingleAgentNotReady"
	AgentCanvasSingleAgentNotReadyRequiredGate  = "agent-v2-kernel-foundation-e2e"
	AgentOwnershipForbiddenActorLocaleKey       = "agent.errors.forbiddenActor"
	AgentAttachmentRejectedLocaleKey            = "agent.errors.attachmentRejected"
	AgentRuntimeIncompatibleCapabilityLocaleKey = "agent.errors.incompatibleCapability"
	AgentToolApprovalDeniedLocaleKey            = "agent.errors.toolApprovalDenied"
	AgentToolApprovalExpiredLocaleKey           = "agent.errors.toolApprovalExpired"
	AgentClientExecutorUnavailableLocaleKey     = "agent.errors.executorUnavailable"
	AgentToolBudgetExhaustedLocaleKey           = "agent.errors.toolLoopBudgetExhausted"
	AgentContextOverflowLocaleKey               = "agent.errors.contextOverflow"
	AgentContextInvalidReferenceLocaleKey       = "agent.errors.contextInvalidReference"
	AgentLifecycleCancelledLocaleKey            = "agent.errors.lifecycleCancelled"
	AgentLifecycleInterruptedLocaleKey          = "agent.errors.lifecycleInterrupted"
	AgentProviderCredentialMissingLocaleKey     = "agent.errors.providerCredentialMissing"
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

func NewOwnershipForbiddenActor(resourceKind, resourceID string) *BizError {
	return &BizError{
		Code:       AgentOwnershipForbiddenActor,
		HTTPStatus: http.StatusForbidden,
		Message:    AgentOwnershipForbiddenActorLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentOwnershipForbiddenActorLocaleKey,
			ErrorType: string(AgentOwnershipForbiddenActor),
			LocaleKey: AgentOwnershipForbiddenActorLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"resource_kind": resourceKind,
				"resource_id":   resourceID,
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

func NewRuntimeIncompatibleCapability(capabilityID, reasonCode string) *BizError {
	return &BizError{
		Code:       AgentRuntimeIncompatibleCapability,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    AgentRuntimeIncompatibleCapabilityLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentRuntimeIncompatibleCapabilityLocaleKey,
			ErrorType: string(AgentRuntimeIncompatibleCapability),
			LocaleKey: AgentRuntimeIncompatibleCapabilityLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"capability_id": capabilityID,
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

func NewClientExecutorUnavailablePayload(targetDeviceID, capabilityID string) *model.ErrorPayload {
	return &model.ErrorPayload{
		Error:     AgentClientExecutorUnavailableLocaleKey,
		ErrorType: string(AgentClientExecutorUnavailable),
		LocaleKey: AgentClientExecutorUnavailableLocaleKey,
		Retryable: true,
		Terminal:  true,
		Details: map[string]string{
			"target_device_id": targetDeviceID,
			"capability_id":    capabilityID,
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

func NewLifecycleInterruptedPayload(turnID, reasonCode string) *model.ErrorPayload {
	return &model.ErrorPayload{
		Error:     AgentLifecycleInterruptedLocaleKey,
		ErrorType: string(AgentLifecycleInterrupted),
		LocaleKey: AgentLifecycleInterruptedLocaleKey,
		Retryable: true,
		Terminal:  true,
		Details: map[string]string{
			"turn_id":     turnID,
			"reason_code": reasonCode,
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

// NewContextInvalidReference returns the typed rejection for retired inline
// context syntax without exposing the reference token to clients.
func NewContextInvalidReference(referenceKind, referenceToken string) *BizError {
	referenceHash := sha256.Sum256([]byte(referenceToken))

	return &BizError{
		Code:       AgentContextInvalidReference,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    AgentContextInvalidReferenceLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentContextInvalidReferenceLocaleKey,
			ErrorType: string(AgentContextInvalidReference),
			LocaleKey: AgentContextInvalidReferenceLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"reference_kind": referenceKind,
				"reference_hash": fmt.Sprintf("%x", referenceHash),
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

func NewAdmissionDuplicateConflict(idempotencyKey, existingCommandID string) *BizError {
	idempotencyKeyHash := sha256.Sum256([]byte(idempotencyKey))
	return &BizError{
		Code:       AgentIdempotencyConflict,
		HTTPStatus: http.StatusConflict,
		Message:    AgentAdmissionDuplicateConflictLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentAdmissionDuplicateConflictLocaleKey,
			ErrorType: string(AgentAdmissionDuplicateConflict),
			LocaleKey: AgentAdmissionDuplicateConflictLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"idempotency_key_hash": fmt.Sprintf("%x", idempotencyKeyHash),
				"existing_command_id":  existingCommandID,
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
