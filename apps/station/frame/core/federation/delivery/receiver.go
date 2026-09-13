package delivery

import (
	"context"
	"fmt"
	"reflect"
	"sync"

	"google.golang.org/protobuf/proto"
)

// Result is the protocol-level outcome of receiving one frame.
type Result struct {
	Disposition Disposition
	ErrorCode   FrameErrorCode
}

// AcceptedResult reports a newly committed domain delivery.
func AcceptedResult() Result {
	return Result{Disposition: DispositionAccepted}
}

// DuplicateResult reports an exact replay that caused no second mutation.
func DuplicateResult() Result {
	return Result{Disposition: DispositionDuplicate}
}

// RetryableResult reports a delivery that must remain in the sender outbox.
func RetryableResult(code FrameErrorCode) Result {
	return Result{Disposition: DispositionRetryable, ErrorCode: code}
}

// TerminalResult reports a permanent rejection.
func TerminalResult(code FrameErrorCode) Result {
	return Result{Disposition: DispositionTerminal, ErrorCode: code}
}

// PayloadHashConflictResult reports identity reuse with different canonical bytes.
func PayloadHashConflictResult() Result {
	return Result{
		Disposition: DispositionPayloadHashConflict,
		ErrorCode:   FrameErrorPayloadHashConflict,
	}
}

// Receiver is a domain adapter selected by the generated payload-kind enum.
type Receiver interface {
	Receive(ctx context.Context, tx Transaction, frame *Frame) (Result, error)
}

// ReceiverFunc adapts a function to Receiver.
type ReceiverFunc func(context.Context, Transaction, *Frame) (Result, error)

// Receive invokes f.
func (f ReceiverFunc) Receive(
	ctx context.Context,
	tx Transaction,
	frame *Frame,
) (Result, error) {
	return f(ctx, tx, frame)
}

// ProtoReceiver receives one decoded generated protobuf payload.
type ProtoReceiver[T proto.Message] func(
	ctx context.Context,
	tx Transaction,
	payload T,
	frame *Frame,
) (Result, error)

// EphemeralProtoReceiver receives a verified payload outside durable storage.
type EphemeralProtoReceiver[T proto.Message] func(
	ctx context.Context,
	payload T,
	frame *Frame,
) (Result, error)

// QoS is fixed by the registry for each payload kind.
type QoS uint8

const (
	QoSDurable QoS = iota + 1
	QoSEphemeral
)

type registration struct {
	receiver Receiver
	qos      QoS
}

// Registry maps each generated payload kind to exactly one domain receiver.
type Registry struct {
	mu        sync.RWMutex
	receivers map[PayloadKind]registration
	sealed    bool
}

// NewRegistry creates an empty receiver registry without global mutable state.
func NewRegistry() *Registry {
	return &Registry{receivers: make(map[PayloadKind]registration)}
}

// Register binds kind once and rejects unspecified or duplicate registrations.
func (r *Registry) Register(kind PayloadKind, receiver Receiver) error {
	return r.register(kind, QoSDurable, receiver)
}

// RegisterEphemeral binds kind to verified, bounded, non-durable dispatch.
func (r *Registry) RegisterEphemeral(kind PayloadKind, receiver Receiver) error {
	return r.register(kind, QoSEphemeral, receiver)
}

func (r *Registry) register(kind PayloadKind, qos QoS, receiver Receiver) error {
	if r == nil {
		return NewError(FailureInvalidArgument, "register receiver", errorsText("registry is nil"))
	}
	if kind == PayloadKindUnspecified ||
		kind.Descriptor().Values().ByNumber(kind.Number()) == nil {
		return NewError(FailureInvalidArgument, "register receiver", errorsText("payload kind is unspecified or unknown"))
	}
	if qos != QoSDurable && qos != QoSEphemeral {
		return NewError(FailureInvalidArgument, "register receiver", errorsText("receiver QoS is invalid"))
	}
	if isNil(receiver) {
		return NewError(FailureInvalidArgument, "register receiver", errorsText("receiver is nil"))
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed {
		return NewError(
			FailureInvalidArgument,
			"register receiver",
			errorsText("registry is sealed"),
		)
	}
	if _, exists := r.receivers[kind]; exists {
		return NewError(
			FailureInvalidArgument,
			"register receiver",
			fmt.Errorf("payload kind %s is already registered", kind),
		)
	}
	r.receivers[kind] = registration{receiver: receiver, qos: qos}
	return nil
}

// Seal prevents all subsequent registrations, including through retained
// registry pointers.
func (r *Registry) Seal() error {
	if r == nil {
		return NewError(
			FailureInvalidArgument,
			"seal receiver registry",
			errorsText("registry is nil"),
		)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sealed = true

	return nil
}

// Lookup returns the receiver currently bound to kind.
func (r *Registry) Lookup(kind PayloadKind) (Receiver, bool) {
	if r == nil {
		return nil, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	registered, ok := r.receivers[kind]
	return registered.receiver, ok
}

func (r *Registry) lookup(kind PayloadKind) (registration, bool) {
	if r == nil {
		return registration{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	registered, ok := r.receivers[kind]

	return registered, ok
}

// RegisterProtoReceiver binds a generated payload kind to a compile-time typed decoder.
func RegisterProtoReceiver[T proto.Message](
	registry *Registry,
	kind PayloadKind,
	newPayload func() T,
	receiver ProtoReceiver[T],
) error {
	if newPayload == nil || receiver == nil {
		return NewError(FailureInvalidArgument, "register protobuf receiver", errorsText("factory and receiver are required"))
	}
	return registry.Register(kind, ReceiverFunc(func(
		ctx context.Context,
		tx Transaction,
		frame *Frame,
	) (Result, error) {
		payload := newPayload()
		value := reflect.ValueOf(payload)
		if !value.IsValid() || (value.Kind() == reflect.Ptr && value.IsNil()) {
			return Result{}, NewError(
				FailureInvalidArgument,
				"construct protobuf payload",
				errorsText("payload factory returned nil"),
			)
		}
		if err := proto.Unmarshal(frame.OpaquePayload, payload); err != nil {
			return TerminalResult(FrameErrorInvalidFrame), nil
		}
		if len(payload.ProtoReflect().GetUnknown()) != 0 {
			return TerminalResult(FrameErrorInvalidFrame), nil
		}
		return receiver(ctx, tx, payload, frame)
	}))
}

// RegisterEphemeralProtoReceiver binds a generated payload kind to non-durable dispatch.
func RegisterEphemeralProtoReceiver[T proto.Message](
	registry *Registry,
	kind PayloadKind,
	newPayload func() T,
	receiver EphemeralProtoReceiver[T],
) error {
	if newPayload == nil || receiver == nil {
		return NewError(
			FailureInvalidArgument,
			"register ephemeral protobuf receiver",
			errorsText("factory and receiver are required"),
		)
	}

	return registry.RegisterEphemeral(kind, ReceiverFunc(func(
		ctx context.Context,
		_ Transaction,
		frame *Frame,
	) (Result, error) {
		payload := newPayload()
		value := reflect.ValueOf(payload)
		if !value.IsValid() || (value.Kind() == reflect.Ptr && value.IsNil()) {
			return Result{}, NewError(
				FailureInvalidArgument,
				"construct ephemeral protobuf payload",
				errorsText("payload factory returned nil"),
			)
		}
		if err := proto.Unmarshal(frame.OpaquePayload, payload); err != nil {
			return TerminalResult(FrameErrorInvalidFrame), nil
		}
		if len(payload.ProtoReflect().GetUnknown()) != 0 {
			return TerminalResult(FrameErrorInvalidFrame), nil
		}

		return receiver(ctx, payload, frame)
	}))
}

func validateResult(result Result) error {
	switch result.Disposition {
	case DispositionAccepted, DispositionDuplicate:
		if result.ErrorCode != FrameErrorUnspecified {
			return NewError(FailureInvalidResult, "validate receiver result", errorsText("successful result has an error code"))
		}
	case DispositionRetryable, DispositionTerminal, DispositionPayloadHashConflict:
		if result.ErrorCode == FrameErrorUnspecified {
			return NewError(FailureInvalidResult, "validate receiver result", errorsText("failure result has no error code"))
		}
	default:
		return NewError(FailureInvalidResult, "validate receiver result", errorsText("disposition is unspecified"))
	}
	return nil
}

func isNil(value interface{}) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Ptr, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}
