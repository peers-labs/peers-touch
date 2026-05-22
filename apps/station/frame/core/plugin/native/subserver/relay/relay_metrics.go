package relay

// 2026-04-08: Consolidated all relay metrics into a single file.
// Previously scattered across handler.go and relay.go.

import "github.com/peers-labs/peers-touch/station/frame/core/metrics"

// ---- Connection-level metrics (used by relay.go accept loop) ----

var metConnectionsTotal = metrics.Get().Counter(
	"relay_connections_total",
	"Total stream connections established/rejected",
	"result",
)

var metActiveStreams = metrics.Get().Gauge(
	"relay_active_streams",
	"Current number of active station streams",
)

// ---- Forward-level metrics (used by handler_station.go forward) ----

var metForwardTotal = metrics.Get().Counter(
	"relay_forwards_total",
	"Total number of forwarded requests",
	"status",
)

var metForwardDuration = metrics.Get().Histogram(
	"relay_forward_duration_seconds",
	"Histogram of forward request durations",
	[]float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
)

var metInflightForwards = metrics.Get().Gauge(
	"relay_inflight_forwards",
	"Current number of in-flight forward requests",
)

// ---- Broadcast / pub-sub metrics (Tier C1 — push-style invalidation) ----
//
// Three signals are exposed:
//
//   * relay_broadcast_received_total{topic,result}
//       — every Broadcast frame the relay decoded from a stream.
//         result ∈ {allowed, dropped_disallowed_topic} so an operator
//         can see if a misconfigured station is hammering an unknown
//         topic.
//
//   * relay_broadcast_forwarded_total{topic,result}
//       — every per-sibling write attempt during fan-out.
//         result ∈ {ok, error}. The ratio of error/total is the
//         single most useful signal for "broadcasts arriving but
//         siblings dropping them".
//
//   * relay_broadcast_fanout_size{topic}
//       — histogram of how many siblings each successful broadcast
//         was sent to. With a 4-station bench the meaningful range
//         is 0..3, but we keep larger buckets so the same metric
//         scales to bigger deployments without a config change.

// Bounded label values for broadcast metrics. Using consts (rather
// than ad-hoc string literals at the call site) prevents typos from
// silently splitting a counter into two series.
const (
	broadcastResultAllowed           = "allowed"
	broadcastResultDroppedDisallowed = "dropped_disallowed_topic"
	broadcastResultOK                = "ok"
	broadcastResultError             = "error"
)

var metBroadcastReceived = metrics.Get().Counter(
	"relay_broadcast_received_total",
	"Total Broadcast frames received from streams",
	"topic", "result",
)

var metBroadcastForwarded = metrics.Get().Counter(
	"relay_broadcast_forwarded_total",
	"Total per-sibling broadcast write attempts during fan-out",
	"topic", "result",
)

var metBroadcastFanoutSize = metrics.Get().Histogram(
	"relay_broadcast_fanout_size",
	"Histogram of sibling count per broadcast fan-out (snapshot at dispatch time)",
	[]float64{0, 1, 2, 4, 8, 16, 32, 64},
	"topic",
)
