// Package ingress owns the plugin-agnostic host pipeline for inbound channel
// events: idempotent admission, panic recovery and outbound text shaping.
//
// The mechanisms are ported from the reference product's channel middleware
// (dedup leader/waiter keyed by platform event and message ids, acceptance
// observers, panic recovery, per-platform reply truncation). Lark-specific
// knowledge never enters this package.
package ingress

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

// ErrRetryOnly asks the transport to reject the current delivery without a
// user-visible reply: admission never happened, and platform redelivery is
// safe because the idempotency keys make replay side-effect free.
var ErrRetryOnly = errors.New("retry channel message without a user-visible reply")

// Handler processes one admitted, normalized inbound event and returns the
// final plain-text reply (empty when no reply is needed).
type Handler func(ctx context.Context, event *model.NormalizedInboundEvent) (string, error)

// Middleware wraps a Handler with cross-cutting behavior.
type Middleware func(Handler) Handler

// ApplyMiddleware chains middlewares around a handler. The first middleware
// in the list is the outermost.
func ApplyMiddleware(h Handler, mws ...Middleware) Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// RuntimeCallbacks carries transport acceptance hooks. The host pipeline
// marks acceptance exactly when the downstream turn has been durably
// admitted, so plugin transports can acknowledge the platform before the
// (potentially long) turn finishes.
type RuntimeCallbacks struct {
	// MarkAccepted signals successful admission directly.
	MarkAccepted func()
	// MarkDuplicate signals this delivery was suppressed because another
	// delivery already owns the event. The transport still acknowledges it
	// successfully, without invoking downstream work.
	MarkDuplicate func()
	// RegisterAcceptanceObserver lets downstream report a later, asynchronous
	// admission decision.
	RegisterAcceptanceObserver func(accepted func(bool))
}

type runtimeCallbacksKeyType struct{}

var runtimeCallbacksKey runtimeCallbacksKeyType

// WithRuntimeCallbacks attaches transport callbacks to the event context.
func WithRuntimeCallbacks(ctx context.Context, callbacks RuntimeCallbacks) context.Context {
	return context.WithValue(ctx, runtimeCallbacksKey, callbacks)
}

// MarkMessageAccepted notifies the transport that the event was admitted.
func MarkMessageAccepted(ctx context.Context) {
	callbacks, _ := ctx.Value(runtimeCallbacksKey).(RuntimeCallbacks)
	if callbacks.MarkAccepted != nil {
		callbacks.MarkAccepted()
	}
}

// MarkMessageDuplicate notifies the transport that the delivery was
// suppressed as a duplicate.
func MarkMessageDuplicate(ctx context.Context) {
	callbacks, _ := ctx.Value(runtimeCallbacksKey).(RuntimeCallbacks)
	if callbacks.MarkDuplicate != nil {
		callbacks.MarkDuplicate()
	}
}

func registerAcceptanceObserver(ctx context.Context, observer func(bool)) {
	callbacks, _ := ctx.Value(runtimeCallbacksKey).(RuntimeCallbacks)
	if callbacks.RegisterAcceptanceObserver != nil {
		callbacks.RegisterAcceptanceObserver(observer)
	}
}

func tracksTransportAcceptance(ctx context.Context) bool {
	callbacks, _ := ctx.Value(runtimeCallbacksKey).(RuntimeCallbacks)
	return callbacks.RegisterAcceptanceObserver != nil || callbacks.MarkAccepted != nil
}
