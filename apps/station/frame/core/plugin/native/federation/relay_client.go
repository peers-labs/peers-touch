// relay_client.go — runtime singleton describing this station's egress
// relay channel. The federation resolver uses it to forward HTTP requests
// to peer stations through `/relay/forward/<peer_id>/...` without having
// to import the relay-client subserver directly (which would invert
// layering: federation is read by relay-client at startup, not the other
// way around).
//
// Lifecycle:
//
//   - The relay-client subserver, once it has acquired a relay token and
//     opened the framed stream, calls RegisterRelayClient with a snapshot
//     of (BaseURL, Token, accessor). The accessor lets federation read
//     the freshest token without holding a copy that goes stale on
//     refresh; the relay-client subserver rotates tokens internally.
//   - The federation resolver calls RelayClient() per request to obtain
//     the current credentials. Nil result == relay-client not yet ready
//     or disabled; the resolver returns ErrRelayUnavailable in that case.
//
// Why a singleton? At most one relay-client subserver runs per station
// (the framework's subserver registry enforces that). The federation
// surface is read-only from federation's side; the relay-client owns
// every aspect of token lifecycle.

package federation

import (
	"context"
	"errors"
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
// Implementations MUST be safe for concurrent use; the resolver may call
// Token() from many request goroutines at once.
type RelayClientHandle interface {
	// BaseURL returns the relay's HTTP origin (no trailing slash). The
	// resolver builds forward URLs as `<base>/relay/forward/<peer>/<path>`.
	BaseURL() string

	// Token returns the relay-access bearer token currently held by the
	// relay-client subserver. May return "" briefly during register /
	// refresh; callers must treat that as transient and retry later.
	Token() string

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
