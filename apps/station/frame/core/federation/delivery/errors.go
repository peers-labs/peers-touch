package delivery

import (
	"errors"
	"fmt"
)

// FailureCode identifies a delivery-layer failure without importing business semantics.
type FailureCode string

const (
	FailureInvalidArgument      FailureCode = "invalid_argument"
	FailureInvalidFrame         FailureCode = "invalid_frame"
	FailureUnauthenticated      FailureCode = "unauthenticated_source"
	FailureWrongTarget          FailureCode = "wrong_target"
	FailureUnsupportedPayload   FailureCode = "unsupported_payload"
	FailurePayloadHashConflict  FailureCode = "payload_hash_conflict"
	FailureExpired              FailureCode = "expired"
	FailureOverloaded           FailureCode = "overloaded"
	FailureDomainRejected       FailureCode = "domain_rejected"
	FailureDomainDispatch       FailureCode = "domain_dispatch"
	FailureLeaseFenced          FailureCode = "lease_fenced"
	FailureTransportUnavailable FailureCode = "transport_unavailable"
	FailureInvalidResult        FailureCode = "invalid_result"
	FailurePersistence          FailureCode = "persistence"
)

// Error carries a stable failure code while preserving operation context and cause.
type Error struct {
	Code      FailureCode
	Operation string
	Cause     error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Cause == nil {
		return fmt.Sprintf("federation delivery %s: %s", e.Operation, e.Code)
	}
	return fmt.Sprintf("federation delivery %s: %s: %v", e.Operation, e.Code, e.Cause)
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (e *Error) Is(target error) bool {
	var other *Error
	return errors.As(target, &other) && e.Code == other.Code
}

// NewError creates a typed delivery error with operation context.
func NewError(code FailureCode, operation string, cause error) error {
	return &Error{Code: code, Operation: operation, Cause: cause}
}

// FailureCodeOf returns the stable failure code carried by err.
func FailureCodeOf(err error) (FailureCode, bool) {
	var deliveryError *Error
	if !errors.As(err, &deliveryError) {
		return "", false
	}
	return deliveryError.Code, true
}

var (
	ErrInvalidArgument     = &Error{Code: FailureInvalidArgument}
	ErrInvalidFrame        = &Error{Code: FailureInvalidFrame}
	ErrUnauthenticated     = &Error{Code: FailureUnauthenticated}
	ErrWrongTarget         = &Error{Code: FailureWrongTarget}
	ErrUnsupportedPayload  = &Error{Code: FailureUnsupportedPayload}
	ErrPayloadHashConflict = &Error{Code: FailurePayloadHashConflict}
	ErrExpired             = &Error{Code: FailureExpired}
	ErrOverloaded          = &Error{Code: FailureOverloaded}
	ErrDomainRejected      = &Error{Code: FailureDomainRejected}
	ErrLeaseFenced         = &Error{Code: FailureLeaseFenced}
	ErrPersistence         = &Error{Code: FailurePersistence}
)
