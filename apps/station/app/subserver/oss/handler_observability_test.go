package oss

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/worker"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

// stubObsBackend is a `storage.Backend` whose Healthz outcome the
// test controls. We only need the methods the handler actually
// touches; the rest exist to satisfy the interface.
type stubObsBackend struct{ healthErr error }

func (s stubObsBackend) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (s stubObsBackend) Open(context.Context, string, *storage.Range) (io.ReadCloser, int64, string, error) {
	return io.NopCloser(strings.NewReader("")), 0, "", nil
}
func (s stubObsBackend) Stat(context.Context, string) (*storage.StatInfo, error) { return nil, nil }
func (s stubObsBackend) Healthz(context.Context) error                           { return s.healthErr }
func (s stubObsBackend) Delete(context.Context, string) error                    { return nil }

// stubObsMeta is a stand-in MetaRepository whose Get outcome the
// test controls. It satisfies only the methods our handlers call;
// other callers (the real subserver) won't see this stub.
type stubObsMeta struct {
	getErr error
}

func (s *stubObsMeta) Get(context.Context, string) (string, error)          { return "", s.getErr }
func (s *stubObsMeta) Set(context.Context, string, string, time.Time) error { return nil }
func (s *stubObsMeta) Delete(context.Context, ...string) (int64, error)     { return 0, nil }
func (s *stubObsMeta) SetCapabilityVersion(context.Context, time.Time) (string, error) {
	return "", nil
}

// makeObsServer returns a subserver wired with the minimum needed
// to exercise the observability handlers — meta, backend, and a
// federation key cache. The caller can post-tweak fields per test.
func makeObsServer(t *testing.T) *ossSubServer {
	t.Helper()
	memStore := federation.NewInMemoryKeyStore()
	return &ossSubServer{
		pathBase:    "/sub-oss",
		backendType: "local",
		backend:     stubObsBackend{},
		metaRepo:    &stubObsMeta{},
		fedCache:    federation.NewKeyCache(memStore),
	}
}

func TestHealthz_OkWhenAllChecksPass(t *testing.T) {
	s := makeObsServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/healthz", nil)
	s.handleHealthz(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	var body healthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status: got %q want ok", body.Status)
	}
	for _, name := range []string{"database", "backend", "federation"} {
		if c, ok := body.Checks[name]; !ok {
			t.Errorf("missing check %q", name)
		} else if c.Status != "ok" {
			t.Errorf("check %q: got %+v", name, c)
		}
	}
	if body.Schema != ossmodel.SchemaVersionCurrent {
		t.Errorf("schema: got %q want %q", body.Schema, ossmodel.SchemaVersionCurrent)
	}
}

func TestHealthz_DegradedWhenBackendFails(t *testing.T) {
	s := makeObsServer(t)
	s.backend = stubObsBackend{healthErr: errors.New("disk full")}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/healthz", nil)
	s.handleHealthz(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503", rec.Code)
	}
	var body healthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "degraded" {
		t.Errorf("status: got %q want degraded", body.Status)
	}
	if body.Checks["backend"].Status != "fail" {
		t.Errorf("backend check should fail: %+v", body.Checks["backend"])
	}
	if !strings.Contains(body.Checks["backend"].Reason, "disk full") {
		t.Errorf("backend reason should echo error: %q", body.Checks["backend"].Reason)
	}
	if body.Checks["database"].Status != "ok" {
		t.Errorf("unrelated checks should still pass: %+v", body.Checks["database"])
	}
}

func TestHealthz_DegradedWhenDatabaseFails(t *testing.T) {
	s := makeObsServer(t)
	s.metaRepo = &stubObsMeta{getErr: errors.New("connection refused")}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/healthz", nil)
	s.handleHealthz(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503", rec.Code)
	}
	var body healthResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Checks["database"].Status != "fail" {
		t.Errorf("database check should fail: %+v", body.Checks["database"])
	}
}

func TestMetrics_DisabledReturnsNotFound(t *testing.T) {
	s := makeObsServer(t)
	// metricsBearerToken left empty
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/metrics", nil)
	s.handleMetrics(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("disabled metrics: got %d want 404", rec.Code)
	}
}

func TestMetrics_RejectsMissingOrWrongBearer(t *testing.T) {
	s := makeObsServer(t)
	s.metricsBearerToken = "secret"

	cases := []struct {
		name, header string
	}{
		{"no header", ""},
		{"non-bearer scheme", "Basic c2VjcmV0"},
		{"wrong token", "Bearer not-the-secret"},
		{"prefix only", "Bearer "},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/sub-oss/metrics", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			s.handleMetrics(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("got %d want 401 for %q (body=%q)", rec.Code, tc.header, rec.Body.String())
			}
		})
	}
}

func TestMetrics_HappyPathExposesBuildInfoAndUp(t *testing.T) {
	s := makeObsServer(t)
	s.metricsBearerToken = "secret"

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/metrics", nil)
	req.Header.Set("Authorization", "Bearer secret")
	s.handleMetrics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := rec.Body.String()
	wantSubstrings := []string{
		"# HELP oss_build_info",
		"# TYPE oss_build_info gauge",
		`oss_build_info{`,
		`backend="local"`,
		fmt.Sprintf(`schema_version="%s"`, ossmodel.SchemaVersionCurrent),
		"# HELP oss_up",
		"oss_up 1",
	}
	for _, sub := range wantSubstrings {
		if !strings.Contains(got, sub) {
			t.Errorf("metrics output missing %q\n--- body ---\n%s", sub, got)
		}
	}
	if ct := rec.Header().Get("Content-Type"); ct != metricsContentType {
		t.Errorf("Content-Type: got %q want %q", ct, metricsContentType)
	}
}

func TestMetrics_ExposesWorkerSeriesWhenSchedulerWired(t *testing.T) {
	s := makeObsServer(t)
	s.metricsBearerToken = "secret"

	// Build a scheduler with one worker and trigger one tick by
	// calling Snapshot's underlying tick state through a real
	// scheduler run. We use a 5ms interval so the test stays
	// fast; the scheduler runs its worker once at boot.
	w := &fakeObsWorker{name: "ttl_sweeper", interval: 5 * time.Millisecond}
	sched := worker.NewScheduler([]worker.Worker{w}, worker.NewMemLock(), nil)
	s.workerScheduler = sched
	if err := sched.Start(context.Background()); err != nil {
		t.Fatalf("scheduler start: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	sched.Stop()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/metrics", nil)
	req.Header.Set("Authorization", "Bearer secret")
	s.handleMetrics(rec, req)

	got := rec.Body.String()
	wantSubstrings := []string{
		"# HELP oss_worker_last_run_unix_seconds",
		`oss_worker_last_run_unix_seconds{worker="ttl_sweeper"}`,
		"# HELP oss_worker_runs_total",
		`oss_worker_runs_total{worker="ttl_sweeper"}`,
		"# HELP oss_worker_errors_total",
		`oss_worker_errors_total{worker="ttl_sweeper"} 0`,
	}
	for _, sub := range wantSubstrings {
		if !strings.Contains(got, sub) {
			t.Errorf("metrics body missing %q\n--- body ---\n%s", sub, got)
		}
	}
}

// fakeObsWorker is a minimal Worker implementation for the
// metrics test — we just want at least one tick to land so the
// snapshot returns non-zero counters.
type fakeObsWorker struct {
	name     string
	interval time.Duration
}

func (w *fakeObsWorker) Name() string                    { return w.name }
func (w *fakeObsWorker) Interval() time.Duration         { return w.interval }
func (w *fakeObsWorker) RunOnce(_ context.Context) error { return nil }

// TestEscapeHelpers locks down the small text-format escaping
// helpers — tiny but security-sensitive in that a malformed help
// or label value can corrupt the entire scrape page.
func TestEscapeHelpers(t *testing.T) {
	if got := escapeMetricHelp("ok line\nsecond line"); strings.Contains(got, "\n") {
		t.Errorf("help should not contain newline: %q", got)
	}
	if got := escapeLabelValue(`a"b\c` + "\n"); got != `a\"b\\c\n` {
		t.Errorf("label escape: got %q", got)
	}
	if got := formatFloat(42); got != "42" {
		t.Errorf("integer formatFloat: %q", got)
	}
	if got := formatFloat(0.5); got != "0.5" {
		t.Errorf("decimal formatFloat: %q", got)
	}
}

// TestConstantTimeEqualString sanity-checks the bearer comparator;
// timing is hard to test deterministically, but length and value
// behaviour are easy.
func TestConstantTimeEqualString(t *testing.T) {
	if !constantTimeEqualString("abc", "abc") {
		t.Errorf("equal strings should return true")
	}
	if constantTimeEqualString("abc", "abd") {
		t.Errorf("differing strings should return false")
	}
	if constantTimeEqualString("abc", "abcd") {
		t.Errorf("different lengths should return false")
	}
}

// TestFederationKeyHealthCheck_Generates ensures the federation
// check actually triggers a fresh keypair generation when the
// store is empty — that is the bootstrap path operators hit.
func TestFederationKeyHealthCheck_Generates(t *testing.T) {
	s := makeObsServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/healthz", nil)
	s.handleHealthz(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	// Confirm the side-effect: the cache has a non-empty kid now.
	k, err := s.fedCache.Get(req.Context())
	if err != nil {
		t.Fatalf("post-healthz fedCache.Get: %v", err)
	}
	if k == nil || k.Kid == "" {
		t.Errorf("federation key cache should be populated after healthz: %+v", k)
	}
	if len(k.Priv) != ed25519.PrivateKeySize {
		t.Errorf("priv length: got %d want %d", len(k.Priv), ed25519.PrivateKeySize)
	}
	if len(k.Pub) == 0 {
		t.Errorf("pub key should be populated")
	}
}
