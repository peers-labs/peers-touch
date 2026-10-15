package delivery

import (
	"context"
	"errors"
	"strings"
	"time"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
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
	PayloadKindConversationDeliveryReceipt  = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_DELIVERY_RECEIPT
	PayloadKindConversationTyping           = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_TYPING
	PayloadKindConversationReadCursor       = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_READ_CURSOR
	PayloadKindSocialRelationshipEvent      = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_RELATIONSHIP_EVENT
	PayloadKindRealtimeCallSignal           = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_REALTIME_CALL_SIGNAL
	PayloadKindSocialPrivateResource        = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_RESOURCE
	PayloadKindSocialPrivateInvalidation    = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_INVALIDATION
	PayloadKindSocialPrivateInteraction     = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_INTERACTION_COMMAND
	PayloadKindSocialPrivateResult          = federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_INTERACTION_RESULT

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

	defaultMaxEphemeralInFlight = 64
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
	// MaxEphemeralInFlight bounds verified non-durable dispatch. Zero uses the default.
	MaxEphemeralInFlight int
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
	ephemeral  chan struct{}
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
	maxEphemeralInFlight := config.MaxEphemeralInFlight
	if maxEphemeralInFlight == 0 {
		maxEphemeralInFlight = defaultMaxEphemeralInFlight
	}
	if maxEphemeralInFlight < 0 {
		return nil, NewError(
			FailureInvalidArgument,
			"create receiver",
			errorsText("ephemeral in-flight bound must be positive"),
		)
	}

	return &DeliveryReceiver{
		policy:     config.Policy,
		verifier:   config.Verifier,
		registry:   config.Registry,
		unitOfWork: config.UnitOfWork,
		clock:      config.Clock,
		ephemeral:  make(chan struct{}, maxEphemeralInFlight),
	}, nil
}

// Receive invokes authenticated durable or bounded ephemeral domain delivery.
func (r *DeliveryReceiver) Receive(ctx context.Context, frame *Frame) (Result, error) {
	now := r.clock.Now().UTC()
	if err := VerifyFrame(ctx, frame, r.policy, now, r.verifier); err != nil {
		return resultForVerificationError(err), nil
	}
	immutableFrame := proto.Clone(frame).(*Frame)
	if traceID := strings.TrimSpace(immutableFrame.GetTraceId()); traceID != "" {
		ctx = logger.WithTraceID(ctx, traceID)
	}
	registered, registeredKind := r.registry.lookup(immutableFrame.PayloadKind)
	if registeredKind && registered.qos == QoSEphemeral {
		return r.receiveEphemeral(ctx, registered.receiver, immutableFrame)
	}

	result, err := r.unitOfWork.Receive(
		ctx,
		immutableFrame,
		now,
		func(dispatchContext context.Context, tx Transaction, received *Frame) (Result, error) {
			registered, ok := r.registry.lookup(received.PayloadKind)
			if !ok {
				return TerminalResult(FrameErrorUnsupportedPayload), nil
			}
			if registered.qos != QoSDurable {
				return Result{}, NewError(
					FailureInvalidResult,
					"dispatch domain receiver",
					errorsText("ephemeral receiver entered durable unit of work"),
				)
			}
			result, err := registered.receiver.Receive(dispatchContext, tx, received)
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

func (r *DeliveryReceiver) receiveEphemeral(
	ctx context.Context,
	receiver Receiver,
	frame *Frame,
) (Result, error) {
	select {
	case r.ephemeral <- struct{}{}:
		defer func() {
			<-r.ephemeral
		}()
	default:
		return TerminalResult(FrameErrorOverloaded), nil
	}

	result, err := receiver.Receive(ctx, nil, frame)
	if err != nil {
		return Result{}, NewError(
			FailureDomainDispatch,
			"dispatch ephemeral domain receiver",
			err,
		)
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
