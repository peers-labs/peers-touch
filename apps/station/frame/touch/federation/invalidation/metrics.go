package invalidation

// Tier C1 — push-style invalidation observability.
//
// The Prometheus surface for this package is intentionally narrow and
// uses bounded-cardinality labels only:
//
//   * federation_invalidation_received_total{reason}
//       Every event that survived topic + decode and was at least
//       considered for trust-gating. `reason` is the FederationInvalidation
//       reason enum string (REASON_UNSPECIFIED / REASON_VISIBILITY_FLIP /
//       REASON_TOMBSTONE) so the publish-rate split between profile
//       changes and tombstones is visible at a glance.
//
//   * federation_invalidation_dropped_total{cause}
//       Every event that was decoded but NOT applied. `cause` is one
//       of the dropCause* constants below — they cover the trust gate
//       (origin_mismatch / stale_seq), the cache layer (cache_miss /
//       lookup_error), and the format layer (decode_error / bad_handle /
//       unrelated_topic). Distinct error categories ⇒ distinct labels
//       so an operator can answer "which gate is dropping the most"
//       without parsing logs.
//
//   * federation_invalidation_applied_total{reason}
//       Successful evict() calls. Should track received_total minus
//       dropped_total in steady state; large divergence ⇒ a trust gate
//       is rejecting most traffic, look at dropped_total breakdown.
//
//   * federation_invalidation_publish_total{result}
//       Outbound publishes from this station's locator hook. `result`
//       is one of {ok, encode_error, relay_not_connected,
//       publish_error}. The "relay_not_connected" branch is expected
//       traffic when the relay-client is bouncing — counted but kept
//       distinct from real failures.
//
// Cardinality is intrinsically bounded:
//   - reason: 3 values (proto enum)
//   - cause: 7 values (constants below)
//   - result: 4 values (constants below)
//   - no per-handle / per-peer / per-origin labels are emitted

import "github.com/peers-labs/peers-touch/station/frame/core/metrics"

// Drop causes — exhaustive list. Adding a new cause requires updating
// dashboards but not schema, since the label is plain string.
const (
	dropCauseUnrelatedTopic = "unrelated_topic"
	dropCauseDecodeError    = "decode_error"
	dropCauseBadHandle      = "bad_handle"
	dropCauseCacheMiss      = "cache_miss"
	dropCauseLookupError    = "lookup_error"
	dropCauseOriginMismatch = "origin_mismatch"
	dropCauseStaleSeq       = "stale_seq"
)

// Publish results — exhaustive list.
const (
	publishResultOK           = "ok"
	publishResultEncodeError  = "encode_error"
	publishResultRelayNotConn = "relay_not_connected"
	publishResultPublishError = "publish_error"
)

var metReceived = metrics.Get().Counter(
	"federation_invalidation_received_total",
	"Federation invalidation events decoded and considered for trust-gating",
	"reason",
)

var metDropped = metrics.Get().Counter(
	"federation_invalidation_dropped_total",
	"Federation invalidation events decoded but not applied (broken down by cause)",
	"cause",
)

var metApplied = metrics.Get().Counter(
	"federation_invalidation_applied_total",
	"Federation invalidation events that successfully evicted the cache",
	"reason",
)

var metPublish = metrics.Get().Counter(
	"federation_invalidation_publish_total",
	"Outbound federation invalidation publishes from this station's locator hook",
	"result",
)

// ---- Public helpers for the locator hook ----
//
// We expose typed RecordPublish* helpers rather than the raw counter so
// (a) callers can't use a label value that isn't part of the bounded set
// and (b) the metric stays fully internal to this package's ownership.

// RecordPublishOK increments the publish counter for a successful
// publish. Called from the locator hook's publishInvalidationAsync.
func RecordPublishOK() { metPublish.Inc(publishResultOK) }

// RecordPublishEncodeError increments the publish counter when proto
// encoding failed before the bytes hit the wire.
func RecordPublishEncodeError() { metPublish.Inc(publishResultEncodeError) }

// RecordPublishRelayNotConnected increments the publish counter for the
// expected case where the relay-client stream is currently down. The
// invalidation falls back to the DHT slow path; the count is kept
// distinct from real failures so dashboards don't alert on it.
func RecordPublishRelayNotConnected() { metPublish.Inc(publishResultRelayNotConn) }

// RecordPublishError increments the publish counter for any other
// failure (write deadline, conn closed mid-write, etc.).
func RecordPublishError() { metPublish.Inc(publishResultPublishError) }
