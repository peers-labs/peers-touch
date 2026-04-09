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
