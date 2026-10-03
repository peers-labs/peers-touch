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
	AgentInvalidRequest                   Code = "AGENT_4001"
	AgentUnauthorized                     Code = "AGENT_4002"
	AgentNotFound                         Code = "AGENT_4004"
	AgentVersionConflict                  Code = "AGENT_4009"
	AgentNameConflict                     Code = "AGENT_NAME_CONFLICT"
	AgentIdempotencyConflict              Code = "IDEMPOTENCY_CONFLICT"
	AgentInvalidSourceState               Code = "INVALID_SOURCE_STATE"
	AgentActiveDependency                 Code = "ACTIVE_DEPENDENCY"
	AgentOwnershipForbiddenActor          Code = "OWNERSHIP_FORBIDDEN_ACTOR"
	AgentQueueFull                        Code = "ADMISSION_QUEUE_FULL"
	AgentAttachmentRejected               Code = "CONTEXT_ATTACHMENT_REJECTED"
	AgentRuntimeUnavailable               Code = "RUNTIME_UNAVAILABLE"
	AgentRuntimeResumeUnavailable         Code = "RUNTIME_RESUME_UNAVAILABLE"
	AgentRuntimeIncompatibleCapability    Code = "RUNTIME_INCOMPATIBLE_CAPABILITY"
	AgentCapabilityManifestNotFound       Code = "CAPABILITY_MANIFEST_NOT_FOUND"
	AgentCapabilityManifestVersionStale   Code = "CAPABILITY_MANIFEST_VERSION_STALE"
	AgentCapabilityManifestSchemaInvalid  Code = "CAPABILITY_MANIFEST_SCHEMA_INVALID"
	AgentCapabilityBindingVersionConflict Code = "CAPABILITY_BINDING_VERSION_CONFLICT"
	AgentCapabilityUnavailable            Code = "CAPABILITY_UNAVAILABLE"
	AgentCapabilityPolicyInvalid          Code = "CAPABILITY_POLICY_INVALID"
	AgentToolUnknown                      Code = "TOOL_UNKNOWN"
	AgentToolApprovalDenied               Code = "TOOL_APPROVAL_DENIED"
	AgentToolApprovalExpired              Code = "TOOL_APPROVAL_EXPIRED"
	AgentClientExecutorUnavailable        Code = "CLIENT_EXECUTOR_UNAVAILABLE"
	AgentClientLeaseExpired               Code = "CLIENT_LEASE_EXPIRED"
	AgentClientPermissionDenied           Code = "CLIENT_PERMISSION_DENIED"
	AgentToolBudgetExhausted              Code = "TOOL_LOOP_BUDGET_EXHAUSTED"
	AgentContextOverflow                  Code = "CONTEXT_OVERFLOW"
	AgentContextInvalidReference          Code = "CONTEXT_INVALID_REFERENCE"
	AgentLifecycleCancelled               Code = "LIFECYCLE_CANCELLED"
	AgentLifecycleInterrupted             Code = "LIFECYCLE_INTERRUPTED"
	AgentLifecycleStaleVersion            Code = "LIFECYCLE_STALE_VERSION"
	AgentLifecycleTerminalMutation        Code = "LIFECYCLE_TERMINAL_MUTATION"
	AgentProviderCredentialMissing        Code = "PROVIDER_CREDENTIAL_MISSING"
	AgentProviderRateLimit                Code = "PROVIDER_RATE_LIMIT"
	AgentProviderModelUnavailable         Code = "PROVIDER_MODEL_UNAVAILABLE"
	AgentProviderTimeout                  Code = "PROVIDER_TIMEOUT"
	AgentConnectorOAuthExpired            Code = "CONNECTOR_OAUTH_EXPIRED"
	AgentConnectorScopeDenied             Code = "CONNECTOR_SCOPE_DENIED"
	AgentConnectorResourceRemoved         Code = "CONNECTOR_RESOURCE_REMOVED"
	AgentConnectorManifestStale           Code = "CONNECTOR_MANIFEST_STALE"
	AgentConnectorDisconnected            Code = "CONNECTOR_DISCONNECTED"
	AgentConnectorProviderRevoked         Code = "CONNECTOR_PROVIDER_REVOKED"
	AgentConnectorRevocationUnconfirmed   Code = "CONNECTOR_REVOCATION_UNCONFIRMED"
	AgentProviderFailed                   Code = "AGENT_5001"
	AgentCompressionFailed                Code = "AGENT_5002"
	AgentDelegationFailed                 Code = "AGENT_5003"
	AgentCredentialFailed                 Code = "AGENT_5004"
	AgentProviderDisabled                 Code = "AGENT_5005"
	AgentSecurityViolation                Code = "AGENT_4003"
	AgentInternal                         Code = "AGENT_5000"

	AgentAdmissionDuplicateConflict Code = "ADMISSION_DUPLICATE_CONFLICT"
	AgentCanvasSingleAgentNotReady  Code = "AGENT_CANVAS_SINGLE_AGENT_NOT_READY"

	AgentAdmissionDuplicateConflictLocaleKey       = "agent.errors.duplicateConflict"
	AgentNameConflictLocaleKey                     = "agent.errors.nameConflict"
	AgentCanvasSingleAgentNotReadyLocaleKey        = "agent.errors.canvasSingleAgentNotReady"
	AgentCanvasSingleAgentNotReadyRequiredGate     = "agent-v2-kernel-foundation-e2e"
	AgentQueueFullLocaleKey                        = "agent.errors.queueFull"
	AgentOwnershipForbiddenActorLocaleKey          = "agent.errors.forbiddenActor"
	AgentAttachmentRejectedLocaleKey               = "agent.errors.attachmentRejected"
	AgentRuntimeUnavailableLocaleKey               = "agent.errors.runtimeUnavailable"
	AgentRuntimeResumeUnavailableLocaleKey         = "agent.errors.resumeUnavailable"
	AgentRuntimeIncompatibleCapabilityLocaleKey    = "agent.errors.incompatibleCapability"
	AgentCapabilityManifestNotFoundLocaleKey       = "agent.errors.capabilityManifestNotFound"
	AgentCapabilityManifestVersionStaleLocaleKey   = "agent.errors.capabilityManifestVersionStale"
	AgentCapabilityManifestSchemaInvalidLocaleKey  = "agent.errors.capabilityManifestSchemaInvalid"
	AgentCapabilityBindingVersionConflictLocaleKey = "agent.errors.capabilityBindingVersionConflict"
	AgentCapabilityUnavailableLocaleKey            = "agent.errors.capabilityUnavailable"
	AgentCapabilityPolicyInvalidLocaleKey          = "agent.errors.capabilityPolicyInvalid"
	AgentToolUnknownLocaleKey                      = "agent.errors.toolUnknown"
	AgentToolApprovalDeniedLocaleKey               = "agent.errors.toolApprovalDenied"
	AgentToolApprovalExpiredLocaleKey              = "agent.errors.toolApprovalExpired"
	AgentClientExecutorUnavailableLocaleKey        = "agent.errors.executorUnavailable"
	AgentClientLeaseExpiredLocaleKey               = "agent.errors.clientLeaseExpired"
	AgentClientPermissionDeniedLocaleKey           = "agent.errors.clientPermissionDenied"
	AgentToolBudgetExhaustedLocaleKey              = "agent.errors.toolLoopBudgetExhausted"
	AgentContextOverflowLocaleKey                  = "agent.errors.contextOverflow"
	AgentContextInvalidReferenceLocaleKey          = "agent.errors.contextInvalidReference"
	AgentLifecycleCancelledLocaleKey               = "agent.errors.lifecycleCancelled"
	AgentLifecycleInterruptedLocaleKey             = "agent.errors.lifecycleInterrupted"
	AgentLifecycleStaleVersionLocaleKey            = "agent.errors.lifecycleStaleVersion"
	AgentLifecycleTerminalMutationLocaleKey        = "agent.errors.lifecycleTerminalMutation"
	AgentProviderCredentialMissingLocaleKey        = "agent.errors.providerCredentialMissing"
	AgentProviderRateLimitLocaleKey                = "agent.errors.providerRateLimit"
	AgentProviderModelUnavailableLocaleKey         = "agent.errors.providerModelUnavailable"
	AgentProviderTimeoutLocaleKey                  = "agent.errors.providerTimeout"
	AgentConnectorOAuthExpiredLocaleKey            = "agent.errors.connectorOAuthExpired"
	AgentConnectorScopeDeniedLocaleKey             = "agent.errors.connectorScopeDenied"
	AgentConnectorResourceRemovedLocaleKey         = "agent.errors.connectorResourceRemoved"
	AgentConnectorManifestStaleLocaleKey           = "agent.errors.connectorManifestStale"
	AgentConnectorDisconnectedLocaleKey            = "agent.errors.connectorDisconnected"
	AgentConnectorProviderRevokedLocaleKey         = "agent.errors.connectorProviderRevoked"
	AgentConnectorRevocationUnconfirmedLocaleKey   = "agent.errors.connectorRevocationUnconfirmed"
)

const AgentClientInvalidResourceReference Code = "CLIENT_INVALID_RESOURCE_REFERENCE"

const AgentClientInvalidResourceReferenceLocaleKey = "agent.errors.invalidResourceReference"

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

func NewAgentNameConflict() *BizError {
	return &BizError{
		Code:       AgentNameConflict,
		HTTPStatus: http.StatusConflict,
		Message:    AgentNameConflictLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentNameConflictLocaleKey,
			ErrorType: string(AgentNameConflict),
			LocaleKey: AgentNameConflictLocaleKey,
			Retryable: false,
			Terminal:  true,
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

func NewQueueFull(conversationID string, capacity uint32) *BizError {
	return &BizError{
		Code:       AgentQueueFull,
		HTTPStatus: http.StatusTooManyRequests,
		Message:    AgentQueueFullLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentQueueFullLocaleKey,
			ErrorType: string(AgentQueueFull),
			LocaleKey: AgentQueueFullLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"conversation_id": conversationID,
				"capacity":        strconv.FormatUint(uint64(capacity), 10),
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

func NewRuntimeUnavailable(runtimeKind, reasonCode string) *BizError {
	return &BizError{
		Code:       AgentRuntimeUnavailable,
		HTTPStatus: http.StatusServiceUnavailable,
		Message:    AgentRuntimeUnavailableLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentRuntimeUnavailableLocaleKey,
			ErrorType: string(AgentRuntimeUnavailable),
			LocaleKey: AgentRuntimeUnavailableLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"runtime_kind": runtimeKind,
				"reason_code":  reasonCode,
			},
		},
	}
}

func NewRuntimeResumeUnavailable(runtimeProfileID, reasonCode string) *BizError {
	return &BizError{
		Code:       AgentRuntimeResumeUnavailable,
		HTTPStatus: http.StatusConflict,
		Message:    AgentRuntimeResumeUnavailableLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentRuntimeResumeUnavailableLocaleKey,
			ErrorType: string(AgentRuntimeResumeUnavailable),
			LocaleKey: AgentRuntimeResumeUnavailableLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"runtime_profile_id": runtimeProfileID,
				"reason_code":        reasonCode,
			},
		},
	}
}

func NewProviderRateLimit(providerID string, retryAfterMS int64) *BizError {
	if retryAfterMS < 0 {
		retryAfterMS = 0
	}
	return &BizError{
		Code:       AgentProviderRateLimit,
		HTTPStatus: http.StatusTooManyRequests,
		Message:    AgentProviderRateLimitLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentProviderRateLimitLocaleKey,
			ErrorType: string(AgentProviderRateLimit),
			LocaleKey: AgentProviderRateLimitLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"provider_id":    providerID,
				"retry_after_ms": strconv.FormatInt(retryAfterMS, 10),
			},
		},
	}
}

func NewProviderModelUnavailable(providerID, modelID string) *BizError {
	return &BizError{
		Code:       AgentProviderModelUnavailable,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    AgentProviderModelUnavailableLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentProviderModelUnavailableLocaleKey,
			ErrorType: string(AgentProviderModelUnavailable),
			LocaleKey: AgentProviderModelUnavailableLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"provider_id": providerID,
				"model_id":    modelID,
			},
		},
	}
}

func NewProviderTimeout(providerID, modelID string, deadline time.Time) *BizError {
	return &BizError{
		Code:       AgentProviderTimeout,
		HTTPStatus: http.StatusGatewayTimeout,
		Message:    AgentProviderTimeoutLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentProviderTimeoutLocaleKey,
			ErrorType: string(AgentProviderTimeout),
			LocaleKey: AgentProviderTimeoutLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"provider_id": providerID,
				"model_id":    modelID,
				"deadline":    deadline.UTC().Format(time.RFC3339Nano),
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

func NewCapabilityManifestNotFound(capabilityID, capabilityVersion string) *BizError {
	return newCapabilityError(
		AgentCapabilityManifestNotFound,
		AgentCapabilityManifestNotFoundLocaleKey,
		http.StatusNotFound,
		false,
		map[string]string{
			"capability_id":      capabilityID,
			"capability_version": capabilityVersion,
		},
	)
}

func NewCapabilityManifestVersionStale(
	capabilityID string,
	expectedVersion string,
	actualVersion string,
) *BizError {
	return newCapabilityError(
		AgentCapabilityManifestVersionStale,
		AgentCapabilityManifestVersionStaleLocaleKey,
		http.StatusConflict,
		true,
		map[string]string{
			"capability_id":    capabilityID,
			"expected_version": expectedVersion,
			"actual_version":   actualVersion,
		},
	)
}

func NewCapabilityManifestSchemaInvalid(
	capabilityID string,
	schemaField string,
	reasonCode string,
) *BizError {
	return newCapabilityError(
		AgentCapabilityManifestSchemaInvalid,
		AgentCapabilityManifestSchemaInvalidLocaleKey,
		http.StatusUnprocessableEntity,
		false,
		map[string]string{
			"capability_id": capabilityID,
			"schema_field":  schemaField,
			"reason_code":   reasonCode,
		},
	)
}

func NewCapabilityBindingVersionConflict(
	bindingID string,
	expectedRevision uint64,
	actualRevision uint64,
) *BizError {
	return newCapabilityError(
		AgentCapabilityBindingVersionConflict,
		AgentCapabilityBindingVersionConflictLocaleKey,
		http.StatusConflict,
		true,
		map[string]string{
			"binding_id":        bindingID,
			"expected_revision": strconv.FormatUint(expectedRevision, 10),
			"actual_revision":   strconv.FormatUint(actualRevision, 10),
		},
	)
}

func NewVersionConflict(
	resourceKind string,
	resourceID string,
	expectedRevision uint64,
	actualRevision uint64,
) *BizError {
	return newCapabilityError(
		AgentVersionConflict,
		AgentLifecycleStaleVersionLocaleKey,
		http.StatusConflict,
		true,
		map[string]string{
			"resource_kind":     resourceKind,
			"resource_id":       resourceID,
			"expected_revision": strconv.FormatUint(expectedRevision, 10),
			"actual_revision":   strconv.FormatUint(actualRevision, 10),
		},
	)
}

func NewCapabilityUnavailable(
	capabilityID string,
	targetDeviceID string,
	reasonCode string,
) *BizError {
	return newCapabilityError(
		AgentCapabilityUnavailable,
		AgentCapabilityUnavailableLocaleKey,
		http.StatusUnprocessableEntity,
		true,
		map[string]string{
			"capability_id":    capabilityID,
			"target_device_id": targetDeviceID,
			"reason_code":      reasonCode,
		},
	)
}

func NewCapabilityPolicyInvalid(bindingID, policyKind, reasonCode string) *BizError {
	return newCapabilityError(
		AgentCapabilityPolicyInvalid,
		AgentCapabilityPolicyInvalidLocaleKey,
		http.StatusBadRequest,
		false,
		map[string]string{
			"binding_id":  bindingID,
			"policy_kind": policyKind,
			"reason_code": reasonCode,
		},
	)
}

func newCapabilityError(
	code Code,
	localeKey string,
	httpStatus int,
	retryable bool,
	details map[string]string,
) *BizError {
	return &BizError{
		Code:       code,
		HTTPStatus: httpStatus,
		Message:    localeKey,
		Payload: &model.ErrorPayload{
			Error:     localeKey,
			ErrorType: string(code),
			LocaleKey: localeKey,
			Retryable: retryable,
			Terminal:  true,
			Details:   details,
		},
	}
}

func NewToolUnknown(toolID, toolVersion string) *BizError {
	return &BizError{
		Code:       AgentToolUnknown,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    AgentToolUnknownLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentToolUnknownLocaleKey,
			ErrorType: string(AgentToolUnknown),
			LocaleKey: AgentToolUnknownLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"tool_id":      toolID,
				"tool_version": toolVersion,
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

func NewClientPermissionDenied(capabilityID, permissionKind string) *BizError {
	return &BizError{
		Code:       AgentClientPermissionDenied,
		HTTPStatus: http.StatusForbidden,
		Message:    AgentClientPermissionDeniedLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentClientPermissionDeniedLocaleKey,
			ErrorType: string(AgentClientPermissionDenied),
			LocaleKey: AgentClientPermissionDeniedLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"capability_id":   capabilityID,
				"permission_kind": permissionKind,
			},
		},
	}
}

func NewConnectorUnavailablePayload(
	status model.ConnectorResourceStatus,
	connectorID string,
	resourceID string,
	connectionRevision uint64,
) *model.ErrorPayload {
	code := AgentConnectorManifestStale
	localeKey := AgentConnectorManifestStaleLocaleKey
	retryable := true
	switch status {
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_EXPIRED:
		code = AgentConnectorOAuthExpired
		localeKey = AgentConnectorOAuthExpiredLocaleKey
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_SCOPE_DENIED:
		code = AgentConnectorScopeDenied
		localeKey = AgentConnectorScopeDeniedLocaleKey
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REMOVED:
		code = AgentConnectorResourceRemoved
		localeKey = AgentConnectorResourceRemovedLocaleKey
		retryable = false
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_DISCONNECTED:
		code = AgentConnectorDisconnected
		localeKey = AgentConnectorDisconnectedLocaleKey
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOKED:
		code = AgentConnectorProviderRevoked
		localeKey = AgentConnectorProviderRevokedLocaleKey
	case model.ConnectorResourceStatus_CONNECTOR_RESOURCE_STATUS_REVOCATION_UNCONFIRMED:
		code = AgentConnectorRevocationUnconfirmed
		localeKey = AgentConnectorRevocationUnconfirmedLocaleKey
	}
	return &model.ErrorPayload{
		Error:     localeKey,
		ErrorType: string(code),
		LocaleKey: localeKey,
		Retryable: retryable,
		Terminal:  true,
		Details: map[string]string{
			"connector_id":        connectorID,
			"resource_id":         resourceID,
			"connection_revision": strconv.FormatUint(connectionRevision, 10),
		},
	}
}

func NewClientLeaseExpired(sessionID, leaseID string, expiredAt time.Time) *BizError {
	return NewClientLeaseExpiredFromPayload(&model.ErrorPayload{
		Error:     AgentClientLeaseExpiredLocaleKey,
		ErrorType: string(AgentClientLeaseExpired),
		LocaleKey: AgentClientLeaseExpiredLocaleKey,
		Retryable: true,
		Terminal:  false,
		Details: map[string]string{
			"session_id": sessionID,
			"lease_id":   leaseID,
			"expired_at": expiredAt.UTC().Format(time.RFC3339Nano),
		},
	})
}

func NewClientLeaseExpiredFromPayload(payload *model.ErrorPayload) *BizError {
	return &BizError{
		Code:       AgentClientLeaseExpired,
		HTTPStatus: http.StatusConflict,
		Message:    AgentClientLeaseExpiredLocaleKey,
		Payload:    payload,
	}
}

func NewClientInvalidResourceReferencePayload(resourceKind, resourceRefHash string) *model.ErrorPayload {
	return &model.ErrorPayload{
		Error:     AgentClientInvalidResourceReferenceLocaleKey,
		ErrorType: string(AgentClientInvalidResourceReference),
		LocaleKey: AgentClientInvalidResourceReferenceLocaleKey,
		Retryable: false,
		Terminal:  true,
		Details: map[string]string{
			"resource_kind":     resourceKind,
			"resource_ref_hash": resourceRefHash,
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

func NewLifecycleStaleVersion(resourceID string, expectedRevision, actualRevision uint64) *BizError {
	return &BizError{
		Code:       AgentLifecycleStaleVersion,
		HTTPStatus: http.StatusConflict,
		Message:    AgentLifecycleStaleVersionLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentLifecycleStaleVersionLocaleKey,
			ErrorType: string(AgentLifecycleStaleVersion),
			LocaleKey: AgentLifecycleStaleVersionLocaleKey,
			Retryable: true,
			Terminal:  true,
			Details: map[string]string{
				"resource_id":       resourceID,
				"expected_revision": strconv.FormatUint(expectedRevision, 10),
				"actual_revision":   strconv.FormatUint(actualRevision, 10),
			},
		},
	}
}

// NewLifecycleTerminalMutation rejects mutation of an already-terminal resource.
func NewLifecycleTerminalMutation(resourceID, terminalStatus string) *BizError {
	return &BizError{
		Code:       AgentLifecycleTerminalMutation,
		HTTPStatus: http.StatusConflict,
		Message:    AgentLifecycleTerminalMutationLocaleKey,
		Payload: &model.ErrorPayload{
			Error:     AgentLifecycleTerminalMutationLocaleKey,
			ErrorType: string(AgentLifecycleTerminalMutation),
			LocaleKey: AgentLifecycleTerminalMutationLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"resource_id":     resourceID,
				"terminal_status": terminalStatus,
			},
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
