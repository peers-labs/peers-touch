package delivery

import (
	"context"
	"errors"
	"time"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"google.golang.org/protobuf/proto"
)

const (
	PayloadKindUnspecified                  = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_UNSPECIFIED
	PayloadKindConversationDeviceDelivery   = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_DEVICE_DELIVERY
	PayloadKindConversationAuthorityCommand = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_AUTHORITY_COMMAND
	PayloadKindConversationAuthorityResult  = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_AUTHORITY_RESULT
	PayloadKindSocialFriendRequestCommand   = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_FRIEND_REQUEST_COMMAND
	PayloadKindSocialFriendRequestEvent     = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_FRIEND_REQUEST_EVENT
	PayloadKindSocialFriendRequestResult    = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_FRIEND_REQUEST_RESULT

	DispositionUnspecified         = federationmodel.FederatedDomainFrameDisposition_FEDERATED_DOMAIN_FRAME_DISPOSITION_UNSPECIFIED
	DispositionAccepted            = federationmodel.FederatedDomainFrameDisposition_FEDERATED_DOMAIN_FRAME_DISPOSITION_ACCEPTED
	DispositionDuplicate           = federationmodel.FederatedDomainFrameDisposition_FEDERATED_DOMAIN_FRAME_DISPOSITION_DUPLICATE
	DispositionRetryable           = federationmodel.FederatedDomainFrameDisposition_FEDERATED_DOMAIN_FRAME_DISPOSITION_RETRYABLE_REJECTION
	DispositionTerminal            = federationmodel.FederatedDomainFrameDisposition_FEDERATED_DOMAIN_FRAME_DISPOSITION_TERMINAL_REJECTION
	DispositionPayloadHashConflict = federationmodel.FederatedDomainFrameDisposition_FEDERATED_DOMAIN_FRAME_DISPOSITION_PAYLOAD_HASH_CONFLICT

	FrameErrorUnspecified         = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_UNSPECIFIED
	FrameErrorInvalidFrame        = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_INVALID_FRAME
	FrameErrorUnauthenticated     = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_UNAUTHENTICATED_SOURCE
	FrameErrorWrongTarget         = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_WRONG_TARGET
	FrameErrorUnsupportedPayload  = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_UNSUPPORTED_PAYLOAD
	FrameErrorPayloadHashConflict = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_PAYLOAD_HASH_CONFLICT
	FrameErrorExpired             = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_EXPIRED
	FrameErrorOverloaded          = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_OVERLOADED
	FrameErrorDomainRejected      = federationmodel.FederatedDomainFrameErrorCode_FEDERATED_DOMAIN_FRAME_ERROR_CODE_DOMAIN_REJECTED
)

// Clock supplies deterministic time to validation, persistence, and dispatch.
type Clock interface {
	Now() time.Time
}

// SystemClock supplies UTC wall-clock time.
type SystemClock struct{}

// Now returns the current UTC time.
func (SystemClock) Now() time.Time {
	return time.Now().UTC()
}

// ReceiverConfig binds frame validation, authentication, registry, and transaction ownership.
type ReceiverConfig struct {
	Policy     FramePolicy
	Verifier   Verifier
	Registry   *Registry
	UnitOfWork UnitOfWork
	Clock      Clock
}

// FrameReceiver is the transport-independent authenticated receive boundary.
type FrameReceiver interface {
	Receive(ctx context.Context, frame *Frame) (Result, error)
}

// DeliveryReceiver validates, authenticates, deduplicates, and dispatches frames.
type DeliveryReceiver struct {
	policy     FramePolicy
	verifier   Verifier
	registry   *Registry
	unitOfWork UnitOfWork
	clock      Clock
}

// NewReceiver creates the single receive path used by remote and local transports.
func NewReceiver(config ReceiverConfig) (*DeliveryReceiver, error) {
	if isNil(config.Verifier) ||
		config.Registry == nil ||
		isNil(config.UnitOfWork) ||
		isNil(config.Clock) {
		return nil, NewError(FailureInvalidArgument, "create receiver", errorsText("all dependencies are required"))
	}
	if err := validateFramePolicy(config.Policy, true); err != nil {
		return nil, err
	}
	return &DeliveryReceiver{
		policy:     config.Policy,
		verifier:   config.Verifier,
		registry:   config.Registry,
		unitOfWork: config.UnitOfWork,
		clock:      config.Clock,
	}, nil
}

// Receive invokes one authenticated, atomic domain delivery.
func (r *DeliveryReceiver) Receive(ctx context.Context, frame *Frame) (Result, error) {
	now := r.clock.Now().UTC()
	if err := VerifyFrame(ctx, frame, r.policy, now, r.verifier); err != nil {
		return resultForVerificationError(err), nil
	}
	immutableFrame := proto.Clone(frame).(*Frame)
	result, err := r.unitOfWork.Receive(
		ctx,
		immutableFrame,
		now,
		func(dispatchContext context.Context, tx Transaction, received *Frame) (Result, error) {
			receiver, ok := r.registry.Lookup(received.PayloadKind)
			if !ok {
				return TerminalResult(FrameErrorUnsupportedPayload), nil
			}
			result, err := receiver.Receive(dispatchContext, tx, received)
			if err != nil {
				return Result{}, NewError(FailureDomainDispatch, "dispatch domain receiver", err)
			}
			if err := validateResult(result); err != nil {
				return Result{}, err
			}
			return result, nil
		},
	)
	if err != nil {
		return Result{}, err
	}
	if err := validateResult(result); err != nil {
		return Result{}, err
	}
	return result, nil
}

func resultForVerificationError(err error) Result {
	switch {
	case errors.Is(err, ErrExpired):
		return TerminalResult(FrameErrorExpired)
	case errors.Is(err, ErrWrongTarget):
		return TerminalResult(FrameErrorWrongTarget)
	case errors.Is(err, ErrUnauthenticated):
		return TerminalResult(FrameErrorUnauthenticated)
	default:
		return TerminalResult(FrameErrorInvalidFrame)
	}
}
