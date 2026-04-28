// Package oss — observability surface (S14): /healthz + /metrics.
//
// /healthz is the operator-friendly readiness probe. It runs three
// short, side-effect-free checks (DB, backend, federation key) and
// returns:
//
//	200 with `{status:"ok", checks:{...}}`        all healthy
//	503 with `{status:"degraded", checks:{...}}`  one or more failures
//
// Each check carries an explicit "ok|fail" outcome and (on
// failure) a one-line reason so a probe scraper can alert on the
// specific failure mode without parsing free-form logs.
//
// /metrics emits Prometheus text-exposition (v0.0.4) — no external
// client library, no scrape protocol negotiation, just a stable
// shape that Prometheus, VictoriaMetrics, and OpenTelemetry can
// all consume. Output is gated by a static bearer token configured
// via `Options.MetricsBearerToken`; an empty token disables the
// endpoint entirely (returns 404) so the default deployment does
// not accidentally publish operational telemetry.
//
// We deliberately do NOT pull in `prometheus/client_golang` —
// the metric set here is small, the surface is stable, and the
// dependency cost (registry locking, label cardinality budgets,
// histogram bucket negotiation) outweighs the value. If a future
// metric demands a histogram or summary we can revisit; today the
// surface is gauges + counters only.
package oss

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
)

// healthCheck is one entry in the /healthz response. We keep the
// shape minimal so probe consumers (Kubernetes liveness, uptime
// monitors, dashboard "stations" tab) can rely on it.
type healthCheck struct {
	Status string `json:"status"`           // "ok" | "fail"
	Reason string `json:"reason,omitempty"` // one-line failure cause
}

type healthResponse struct {
	Status string                 `json:"status"`           // "ok" | "degraded"
	Checks map[string]healthCheck `json:"checks"`           // component → result
	TS     time.Time              `json:"ts"`               // server time at probe
	Schema string                 `json:"schema,omitempty"` // current OSS schema sentinel
}

// handleHealthz runs each check, builds the response, and chooses
// the status code. The check probes are bounded by the request
// context so a slow backend cannot block the probe forever.
func (s *ossSubServer) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	checks := map[string]healthCheck{
		"database":   s.checkDatabase(ctx),
		"backend":    s.checkBackend(ctx),
		"federation": s.checkFederationKey(ctx),
	}

	overall := "ok"
	code := http.StatusOK
	for _, c := range checks {
		if c.Status != "ok" {
			overall = "degraded"
			code = http.StatusServiceUnavailable
			break
		}
	}

	resp := healthResponse{
		Status: overall,
		Checks: checks,
		TS:     time.Now().UTC(),
		Schema: ossmodel.SchemaVersionCurrent,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(resp)
}

// checkDatabase probes the metadata layer with a tiny, deliberately
// missing key read. A "row not found" outcome is the success path
// — what we want to verify is that the connection round-trips, not
// that any specific row exists.
func (s *ossSubServer) checkDatabase(ctx context.Context) healthCheck {
	if s.metaRepo == nil {
		return healthCheck{Status: "fail", Reason: "meta repo not configured"}
	}
	if _, err := s.metaRepo.Get(ctx, "__healthz_probe__"); err != nil {
		return healthCheck{Status: "fail", Reason: err.Error()}
	}
	return healthCheck{Status: "ok"}
}

// checkBackend delegates to the active storage backend's Healthz
// hook. Local backends verify the root directory; S3-style backends
// issue a `BucketExists` probe. Failures here mean uploads will
// fail too.
func (s *ossSubServer) checkBackend(ctx context.Context) healthCheck {
	if s.backend == nil {
		return healthCheck{Status: "fail", Reason: "backend not initialised"}
	}
	if err := s.backend.Healthz(ctx); err != nil {
		return healthCheck{Status: "fail", Reason: err.Error()}
	}
	return healthCheck{Status: "ok"}
}

// checkFederationKey forces a load (or generation) of the local
// federation keypair. Sticky errors from a corrupt PEM surface
// here as a probe failure — operator must intervene.
func (s *ossSubServer) checkFederationKey(ctx context.Context) healthCheck {
	if s.fedKeys == nil {
		return healthCheck{Status: "fail", Reason: "federation key cache not configured"}
	}
	k, err := s.fedKeys.get(ctx)
	if err != nil {
		return healthCheck{Status: "fail", Reason: err.Error()}
	}
	if k == nil || k.kid == "" {
		return healthCheck{Status: "fail", Reason: "federation key missing"}
	}
	return healthCheck{Status: "ok"}
}

// ---------------------------------------------------------------------------
// /metrics — Prometheus text exposition v0.0.4
// ---------------------------------------------------------------------------

// metricsContentType is the content-type Prometheus expects for
// the text exposition format. Pinned to `version=0.0.4` so a
// breaking spec change in the future is a clear signal in the
// scrape headers, not a silent format drift.
const metricsContentType = "text/plain; version=0.0.4; charset=utf-8"

// handleMetrics emits the Prometheus exposition for the OSS
// subserver. Auth is a bearer-token equality check against
// `metricsBearerToken`; an empty token disables the endpoint so
// the default deployment does not publish telemetry over an
// unauthenticated path.
func (s *ossSubServer) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if s.metricsBearerToken == "" {
		// Endpoint is intentionally invisible when disabled.
		// Returning 404 (rather than 503) so a probing tool
		// does not interpret "auth disabled" as "outage".
		http.NotFound(w, r)
		return
	}
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if len(header) <= len(prefix) || header[:len(prefix)] != prefix ||
		!constantTimeEqualString(header[len(prefix):], s.metricsBearerToken) {
		w.Header().Set("WWW-Authenticate", `Bearer realm="oss-metrics"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", metricsContentType)
	s.writeMetricsBody(r.Context(), w)
}

// writeMetricsBody assembles the metric text. We hold no scheduler
// lock during the write — `Snapshot()` already returns a fresh
// slice — so the request does not block worker ticks.
func (s *ossSubServer) writeMetricsBody(ctx context.Context, w http.ResponseWriter) {
	mw := &metricWriter{w: w}

	// Build info: a single "1" sample with labels that identify
	// this subserver (backend driver, schema sentinel). Useful as
	// an info metric in Grafana joins.
	mw.help("oss_build_info", "Static OSS subserver build info; value is always 1.")
	mw.typ("oss_build_info", "gauge")
	mw.sample("oss_build_info", map[string]string{
		"backend":         s.backendType,
		"schema_version":  ossmodel.SchemaVersionCurrent,
		"capabilities_ok": fmt.Sprintf("%d", capabilitiesVersion),
	}, 1)

	// Worker stats — one set of three series per worker: a
	// "last run unix" gauge for freshness alerting, a "runs
	// total" counter for throughput, and an "errors total"
	// counter for error-rate alerting.
	if s.workerScheduler != nil {
		snaps := s.workerScheduler.Snapshot()
		// Stable order keeps diffs readable for human probers.
		sort.Slice(snaps, func(i, j int) bool { return snaps[i].Name < snaps[j].Name })

		mw.help("oss_worker_last_run_unix_seconds",
			"Unix timestamp of the most recent run for the named worker; 0 if never run.")
		mw.typ("oss_worker_last_run_unix_seconds", "gauge")
		for _, s := range snaps {
			ts := int64(0)
			if !s.LastRunAt.IsZero() {
				ts = s.LastRunAt.Unix()
			}
			mw.sample("oss_worker_last_run_unix_seconds",
				map[string]string{"worker": s.Name}, float64(ts))
		}

		mw.help("oss_worker_last_duration_seconds",
			"Wall-clock duration of the most recent run for the named worker.")
		mw.typ("oss_worker_last_duration_seconds", "gauge")
		for _, s := range snaps {
			mw.sample("oss_worker_last_duration_seconds",
				map[string]string{"worker": s.Name}, s.LastDuration.Seconds())
		}

		mw.help("oss_worker_runs_total",
			"Total runs executed for the named worker since process start.")
		mw.typ("oss_worker_runs_total", "counter")
		for _, s := range snaps {
			mw.sample("oss_worker_runs_total",
				map[string]string{"worker": s.Name}, float64(s.RunCount))
		}

		mw.help("oss_worker_errors_total",
			"Total runs that returned an error for the named worker since process start.")
		mw.typ("oss_worker_errors_total", "counter")
		for _, s := range snaps {
			mw.sample("oss_worker_errors_total",
				map[string]string{"worker": s.Name}, float64(s.ErrorCount))
		}
	}

	// Healthz roll-up — `oss_up` is 1 when every component is
	// healthy, 0 otherwise. This is the most common alert
	// target ("oss_up == 0 for 5m → page operator").
	up := 1.0
	if s.metaRepo == nil || s.backend == nil || s.fedKeys == nil {
		up = 0
	} else {
		hctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		if _, err := s.metaRepo.Get(hctx, "__metrics_probe__"); err != nil {
			up = 0
		}
		cancel()
	}
	mw.help("oss_up", "1 if the OSS subserver's database probe succeeds, 0 otherwise.")
	mw.typ("oss_up", "gauge")
	mw.sample("oss_up", nil, up)
}

// metricWriter is a tiny formatter that emits Prometheus text
// exposition. It exists to keep the prom format details (label
// quoting, value formatting, # HELP / # TYPE preamble) out of the
// metric-listing code so additions stay one-liners.
type metricWriter struct {
	w http.ResponseWriter
}

func (m *metricWriter) help(name, doc string) {
	fmt.Fprintf(m.w, "# HELP %s %s\n", name, escapeMetricHelp(doc))
}

func (m *metricWriter) typ(name, kind string) {
	fmt.Fprintf(m.w, "# TYPE %s %s\n", name, kind)
}

// sample writes one metric sample line. Labels are sorted for
// stable output. Float values follow Prometheus' "either an
// integer or a float with at least one digit after the decimal"
// convention via strconv.FormatFloat.
func (m *metricWriter) sample(name string, labels map[string]string, value float64) {
	if len(labels) == 0 {
		fmt.Fprintf(m.w, "%s %s\n", name, formatFloat(value))
		return
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Fprint(m.w, name, "{")
	for i, k := range keys {
		if i > 0 {
			fmt.Fprint(m.w, ",")
		}
		fmt.Fprintf(m.w, `%s=%q`, k, escapeLabelValue(labels[k]))
	}
	fmt.Fprintf(m.w, "} %s\n", formatFloat(value))
}

// escapeMetricHelp prevents a stray newline inside a HELP doc
// from corrupting the exposition. Prometheus' parser treats `\n`
// as the line terminator, so we replace any embedded newline
// with a space.
func escapeMetricHelp(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\n' || c == '\r' {
			out = append(out, ' ')
			continue
		}
		out = append(out, c)
	}
	return string(out)
}

// escapeLabelValue escapes the three characters Prometheus
// requires inside a quoted label value: backslash, double quote,
// and newline.
func escapeLabelValue(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '\\':
			out = append(out, '\\', '\\')
		case '"':
			out = append(out, '\\', '"')
		case '\n':
			out = append(out, '\\', 'n')
		default:
			out = append(out, c)
		}
	}
	return string(out)
}

// formatFloat picks an integer rendering for whole values and a
// minimal-precision float otherwise. Prometheus accepts both, and
// integer-rendered counters scrape as cleaner sample lines.
func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// constantTimeEqualString does a length-equalised byte compare
// without short-circuiting on the first mismatch. Used for the
// metrics bearer-token check so timing differences cannot be
// used to brute-force the token.
func constantTimeEqualString(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
