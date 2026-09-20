package domain

import (
	"errors"
	"fmt"
)

type ErrorCode string

const (
	ErrorCodeInvalidArgument       ErrorCode = "CONVERSATION_INVALID_ARGUMENT"
	ErrorCodeNotFound              ErrorCode = "CONVERSATION_NOT_FOUND"
	ErrorCodeInactive              ErrorCode = "CONVERSATION_INACTIVE"
	ErrorCodeReadOnly              ErrorCode = "CONVERSATION_READ_ONLY"
	ErrorCodeUnauthorized          ErrorCode = "CONVERSATION_UNAUTHORIZED"
	ErrorCodeCommandConflict       ErrorCode = "CONVERSATION_COMMAND_CONFLICT"
	ErrorCodeStaleAuthorityHead    ErrorCode = "CONVERSATION_STALE_AUTHORITY_HEAD"
	ErrorCodeStaleMembershipEpoch  ErrorCode = "CONVERSATION_STALE_MEMBERSHIP_EPOCH"
	ErrorCodeStaleMLSEpoch         ErrorCode = "CONVERSATION_STALE_MLS_EPOCH"
	ErrorCodeDeliverySetMismatch   ErrorCode = "CONVERSATION_DELIVERY_SET_MISMATCH"
	ErrorCodeOwnerProtected        ErrorCode = "CONVERSATION_OWNER_PROTECTED"
	ErrorCodeTargetNotMember       ErrorCode = "CONVERSATION_TARGET_NOT_MEMBER"
	ErrorCodeCommandExpired        ErrorCode = "CONVERSATION_COMMAND_EXPIRED"
	ErrorCodeMemberMuted           ErrorCode = "CONVERSATION_MEMBER_MUTED"
	ErrorCodeMembershipConflict    ErrorCode = "CONVERSATION_MEMBERSHIP_CONFLICT"
	ErrorCodeDeviceConflict        ErrorCode = "CONVERSATION_DEVICE_CONFLICT"
	ErrorCodeHashChainInvalid      ErrorCode = "CONVERSATION_HASH_CHAIN_INVALID"
	ErrorCodeAuthorityPlanStale    ErrorCode = "CONVERSATION_AUTHORITY_PLAN_STALE"
	ErrorCodeAuthorityPlanExpired  ErrorCode = "CONVERSATION_AUTHORITY_PLAN_EXPIRED"
	ErrorCodeAuthorityPlanState    ErrorCode = "CONVERSATION_AUTHORITY_PLAN_STATE"
	ErrorCodeProposalInvalid       ErrorCode = "CONVERSATION_PROPOSAL_INVALID"
	ErrorCodeProposalExpired       ErrorCode = "CONVERSATION_PROPOSAL_EXPIRED"
	ErrorCodeProposalBinding       ErrorCode = "CONVERSATION_PROPOSAL_BINDING_MISMATCH"
	ErrorCodeProposalSignature     ErrorCode = "CONVERSATION_PROPOSAL_SIGNATURE_INVALID"
	ErrorCodeActorKeyUnavailable   ErrorCode = "CONVERSATION_ACTOR_KEY_UNAVAILABLE"
	ErrorCodeActorKeyRevoked       ErrorCode = "CONVERSATION_ACTOR_KEY_REVOKED"
	ErrorCodeFederationInactive    ErrorCode = "CONVERSATION_FEDERATION_STATION_INACTIVE"
	ErrorCodeUnsupportedTransition ErrorCode = "CONVERSATION_UNSUPPORTED_TRANSITION"
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

func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}

func CodeOf(err error) ErrorCode {
	var domainError *Error
	if errors.As(err, &domainError) {
		return domainError.Code
	}
	return ""
}
