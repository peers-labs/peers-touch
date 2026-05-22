// Package invalidation owns the federation pub/sub channel that lets
// a home station push "this cached envelope is stale" events to every
// other station mounted on the same relay (Tier C1 — push-style
// invalidation).
//
// The package has three responsibilities:
//
//  1. Define the wire topic + encode/decode the protobuf payload so
//     publishers (locator hook) and subscribers (this file) speak the
//     same dialect.
//
//  2. Provide a Subscribe() registration that bridges the relay-
//     client read loop into fedcache.Evict — entirely behind the
//     federation.RegisterBroadcastHandler abstraction so the relay-
//     client subserver does NOT depend on touch/federation/cache.
//
//  3. Apply the receiver-side trust gate: an event is only acted on
//     when its `origin_peer_id` (relay-stamped) matches the cached
//     row's `home_station_peer_id` AND the event's locator_seq is
//     >= what we have cached. Anything else is dropped silently — we
//     refuse to evict on behalf of a peer who has no authority over
//     the affected handle, and we refuse to apply a stale replay.
//
// Layering: this package depends on
//   - federation (registry + topic constants)
//   - federation/cache (Evict)
//   - touch/federation/cache (its own contract; same package, separate
//     concern from the invalidation channel itself)
//
// It is itself imported only by the touch-layer composition root that
// wires federation features at startup.
package invalidation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	fedcache "github.com/peers-labs/peers-touch/station/frame/touch/federation/cache"
	invpb "github.com/peers-labs/peers-touch/station/frame/touch/federation/invalidation/pb"
)

// Topic is the relay-allowed pub/sub topic that carries
// FederationInvalidation events. Kept in this package (rather than
// the relay subserver) so the wire identifier and the proto schema
// live next to each other — anyone touching the proto must also
// review the topic constant.
const Topic = "fed.invalidate.v1"

// ErrPayload is returned by the subscriber when a frame body cannot
// be decoded. It is a soft error — we log and drop, never propagate
// up to the read loop.
var ErrPayload = errors.New("invalidation: malformed payload")

// Encode serialises a FederationInvalidation for the wire. The
// returned bytes go straight into the relay-client's Publish() call.
//
// We force `origin_peer_id` to empty here even when the caller fills
// it: the relay is the authority for that field on the wire, and
// shipping a station-supplied value would let a malicious station
// spoof a sibling. Better to silently drop a misuse than to ship
// non-deterministic frames.
func Encode(ev *invpb.FederationInvalidation) ([]byte, error) {
	if ev == nil {
		return nil, errors.New("invalidation: nil event")
	}
	if strings.TrimSpace(ev.GetFederatedHandle()) == "" {
		return nil, errors.New("invalidation: empty federated_handle")
	}
	clone := proto.Clone(ev).(*invpb.FederationInvalidation)
	clone.OriginPeerId = ""
	if clone.IssuedAtUnixMs == 0 {
		clone.IssuedAtUnixMs = time.Now().UnixMilli()
	}
	body, err := proto.Marshal(clone)
	if err != nil {
		return nil, fmt.Errorf("invalidation: marshal: %w", err)
	}
	return body, nil
}

// Decode is the dual of Encode and is exported so unit tests in
// neighbouring packages can drive a synthetic stream.
func Decode(body []byte) (*invpb.FederationInvalidation, error) {
	var ev invpb.FederationInvalidation
	if err := proto.Unmarshal(body, &ev); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPayload, err)
	}
	return &ev, nil
}

// Subscribe installs the relay-client → fedcache bridge. Idempotent —
// calling twice replaces the previously registered handler, which is
// what the test code wants and what the production composition root
// does on every Start().
//
// The handler dispatches by topic:
//
//   - Topic == invalidation.Topic: decode + apply trust gate + Evict.
//   - Anything else: log and drop. Future event types add their own
//     branch here rather than registering a sibling handler, because
//     the federation registry is a single slot by design.
func Subscribe() {
	federation.RegisterBroadcastHandler(handle)
}

// handle is the federation.BroadcastHandler implementation. Exported
// only via Subscribe so that test code can verify "Subscribe wires
// the right callback" without exporting an alternate path.
//
// Each early return increments federation_invalidation_dropped_total
// with a stable cause label. Successful evictions increment
// federation_invalidation_applied_total. The full event count (anything
// past topic check + decode) is on federation_invalidation_received_total
// so dashboards can show the gate funnel:
//
//	received = applied + sum(dropped[cause != "unrelated_topic"])
func handle(ctx context.Context, originPeerID, topic string, body []byte) {
	if topic != Topic {
		// Different topic on the same channel — not a real receive
		// for our purposes, but still useful to count so we notice
		// a registry mis-wire (e.g. someone registers two handlers).
		metDropped.Inc(dropCauseUnrelatedTopic)
		logger.Debugf(ctx, "[fed-inval] dropped unrelated topic=%s origin=%s", topic, originPeerID)
		return
	}

	ev, err := Decode(body)
	if err != nil {
		metDropped.Inc(dropCauseDecodeError)
		logger.Warnf(ctx, "[fed-inval] decode failed origin=%s: %v", originPeerID, err)
		return
	}

	// At this point we have a structured event — count it as received
	// so the funnel math (received = applied + dropped[non-format]) holds.
	reasonLabel := ev.GetReason().String()
	metReceived.Inc(reasonLabel)

	canon, err := locator.CanonicalHandle(ev.GetFederatedHandle())
	if err != nil {
		metDropped.Inc(dropCauseBadHandle)
		logger.Warnf(ctx, "[fed-inval] bad handle %q from %s: %v", ev.GetFederatedHandle(), originPeerID, err)
		return
	}

	cached, err := fedcache.Lookup(ctx, canon)
	if err != nil {
		if errors.Is(err, fedcache.ErrCacheMiss) {
			// Cache miss is the common path — most stations will not
			// have cached most handles. Counted (it IS a drop) so the
			// "broadcasts arriving but nobody cared" rate is visible.
			metDropped.Inc(dropCauseCacheMiss)
			logger.Debugf(ctx, "[fed-inval] miss handle=%s reason=%s origin=%s",
				canon, reasonLabel, originPeerID)
			return
		}
		metDropped.Inc(dropCauseLookupError)
		logger.Warnf(ctx, "[fed-inval] lookup failed handle=%s: %v", canon, err)
		return
	}

	// Trust gate 1: only the home station may evict its own handle.
	// The relay stamps origin_peer_id; we cross-check against what
	// the cached envelope said the home station was. A mismatch can
	// only happen if (a) a peer is forging events, or (b) a handle
	// migrated home stations and our cache is stale — in case (b)
	// the safer behaviour is still to drop and let the slow path
	// (DHT republish) reconcile.
	cachedOwner := strings.TrimSpace(cached.Actor.HomeStationPeerID)
	if cachedOwner == "" || cachedOwner != strings.TrimSpace(originPeerID) {
		metDropped.Inc(dropCauseOriginMismatch)
		logger.Warnf(ctx,
			"[fed-inval] origin mismatch handle=%s cached_owner=%s event_origin=%s — dropping",
			canon, cachedOwner, originPeerID)
		return
	}

	// Trust gate 2: stale replays MUST NOT roll the cache backward.
	// An invalidation older than what we have cached is by definition
	// a replay (or a buggy publisher). We accept equality because
	// visibility flips can repeat at the same locator seq when the
	// same value is re-applied — evicting again is a no-op.
	if ev.GetLocatorSeq() < cached.Actor.LocatorSeq {
		metDropped.Inc(dropCauseStaleSeq)
		logger.Debugf(ctx,
			"[fed-inval] stale handle=%s event_seq=%d cached_seq=%d — dropping",
			canon, ev.GetLocatorSeq(), cached.Actor.LocatorSeq)
		return
	}

	res, err := fedcache.Evict(ctx, canon)
	if err != nil {
		// Evict-after-trust-gate failure is rare (DB write hiccup)
		// and DOES warrant attention. We currently fold it into the
		// lookup_error bucket since dashboards likely already
		// alert on that. If it becomes a frequent class we'll add
		// a dedicated cause label.
		metDropped.Inc(dropCauseLookupError)
		logger.Warnf(ctx, "[fed-inval] evict failed handle=%s: %v", canon, err)
		return
	}

	metApplied.Inc(reasonLabel)
	logger.Infof(ctx,
		"[fed-inval] applied handle=%s reason=%s origin=%s event_seq=%d previous_seq=%d found=%v",
		canon, reasonLabel, originPeerID,
		ev.GetLocatorSeq(), res.PreviousSeq, res.Found)
}
