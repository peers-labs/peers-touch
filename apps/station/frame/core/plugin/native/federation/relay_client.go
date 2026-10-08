// relay_client.go — runtime singleton describing this station's egress
// relay channel. Federation consumers use it to open scoped opaque tunnels
// without importing the relay-client subserver directly (which would invert
// layering: federation is read by relay-client at startup, not the other
// way around).
//
// Lifecycle:
//
//   - The relay-client subserver registers a live handle only while its
//     authenticated mount stream is connected.
//   - Federation consumers call RelayClient() per request. Nil result or
//     Available()==false means relay-client is not ready or disabled.
//
// Why a singleton? At most one relay-client subserver runs per station
// (the framework's subserver registry enforces that). The federation
// surface is read-only from federation's side; the relay-client owns
// every aspect of token lifecycle.

package federation

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
)

// ErrRelayNotConnected is the canonical sentinel returned by
// RelayClientHandle.Publish when the relay stream is currently down.
//
// Defined here (in the federation registry that owns the handle
// interface) rather than in the relay-client subserver so consumers
// in the touch layer can use errors.Is without importing the
// subserver — that would invert layering. The relay-client adapter
// MUST return this exact sentinel on the not-connected path; tests
// guard the adapter's error wiring.
var ErrRelayNotConnected = errors.New("relay-client: not connected")

// RelayClientHandle is the read-only view federation consumers see.
//
// Implementations MUST be safe for concurrent use.
type RelayClientHandle interface {
	// Available reports whether the authenticated mount stream can currently
	// open peer tunnels.
	Available() bool

	// RelayOrigin returns the configured Relay origin for locator mount hints.
	// It is not a transport endpoint for business HTTP and carries no bearer.
	RelayOrigin() string

	// RoundTrip opens a scoped peer tunnel, verifies the target Station route
	// attestation and inner TLS SPKI, and sends one canonical HTTP request.
	// Authorization and business metadata remain inside inner TLS.
	RoundTrip(
		context.Context,
		string,
		*http.Request,
	) (*http.Response, error)

	// Publish writes a Broadcast frame on the relay stream (Tier C1).
	// Returns an error when the stream is not connected; the publisher
	// is best-effort by design — falling back to TTL-based cache
	// invalidation is correct behaviour, so callers should log and
	// move on rather than retry hard.
	//
	// `body` is opaque to the relay; the topic discriminator decides
	// how receivers decode it (today: protobuf-serialised
	// FederationInvalidation for topic "fed.invalidate.v1").
	Publish(ctx context.Context, topic string, body []byte) error
}

var relayClientHandle atomic.Value // stores relayClientHolder

// RegisterRelayClient is called by the relay-client subserver once its
// token has been acquired and the stream is up. Calling it from anywhere
// else is a bug — federation MUST NOT take ownership of relay-client
// state.
func RegisterRelayClient(h RelayClientHandle) {
	if h == nil {
		return
	}
	relayClientHandle.Store(relayClientHolder{h: h})
}

// ClearRelayClient is called by the relay-client subserver at Stop() so
// late requests do not see a stale handle pointing at a torn-down token
// store.
func ClearRelayClient() {
	relayClientHandle.Store(relayClientHolder{})
}

// RelayClient returns the registered handle, or nil if relay-client is
// disabled / not yet started. Consumers MUST guard on nil.
func RelayClient() RelayClientHandle {
	v := relayClientHandle.Load()
	if v == nil {
		return nil
	}
	holder, ok := v.(relayClientHolder)
	if !ok {
		return nil
	}
	return holder.h
}

// relayClientHolder boxes the interface so atomic.Value's "stored type
// must be identical between calls" requirement is satisfied across
// re-registrations (different concrete types of RelayClientHandle).
type relayClientHolder struct {
	h RelayClientHandle
}

// BroadcastHandler dispatches a Broadcast frame received over the
// relay stream (Tier C1). The relay-client subserver invokes the
// registered handler from inside its read loop; implementations must
// return promptly. Topic-based subscribers are expected to compose
// behind a single registered handler — a multiplexer in the
// federation invalidation package today.
type BroadcastHandler func(ctx context.Context, originPeerID, topic string, body []byte)

var broadcastHandle atomic.Value // stores broadcastHolder

// RegisterBroadcastHandler installs the federation-side dispatch hook
// the relay-client subserver pulls into its client.Config at boot.
//
// Layering: the relay-client subserver lives in
// frame/core/plugin/native/subserver/relay-client/ and MUST NOT
// import touch/federation/* (touch depends on core, not the other
// way). Stations register a handler from the touch layer, and the
// subserver picks it up via GetBroadcastHandler at startup — same
// pattern as RegisterRelayClient.
func RegisterBroadcastHandler(h BroadcastHandler) {
	if h == nil {
		return
	}
	broadcastHandle.Store(broadcastHolder{h: h})
}

// GetBroadcastHandler returns the registered handler, or nil when no
// federation subscriber is wired (e.g. station booted with relay-
// client enabled but federation disabled). Consumers MUST guard nil.
func GetBroadcastHandler() BroadcastHandler {
	v := broadcastHandle.Load()
	if v == nil {
		return nil
	}
	holder, ok := v.(broadcastHolder)
	if !ok {
		return nil
	}
	return holder.h
}

type broadcastHolder struct {
	h BroadcastHandler
}
