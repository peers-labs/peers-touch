package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// reconcileFakeBuckets implements the slice of BucketRepository
// the BucketReconciler depends on. We only model ListAll +
// SetUsage; the other methods are no-op stubs to satisfy the
// interface.
type reconcileFakeBuckets struct {
	rows       []ossmodel.Bucket
	listErr    error
	setCalls   []reconcileSetCall
	setErr     error
	setErrFor  map[string]error
}

type reconcileSetCall struct {
	BucketID    string
	UsedBytes   int64
	ObjectCount int64
}

func (b *reconcileFakeBuckets) ListAll(context.Context) ([]ossmodel.Bucket, error) {
	if b.listErr != nil {
		return nil, b.listErr
	}
	out := make([]ossmodel.Bucket, len(b.rows))
	copy(out, b.rows)
	return out, nil
}

func (b *reconcileFakeBuckets) SetUsage(_ context.Context, id string, used, count int64) error {
	if b.setErrFor != nil {
		if e, ok := b.setErrFor[id]; ok {
			return e
		}
	}
	if b.setErr != nil {
		return b.setErr
	}
	b.setCalls = append(b.setCalls, reconcileSetCall{BucketID: id, UsedBytes: used, ObjectCount: count})
	for i := range b.rows {
		if b.rows[i].ID == id {
			b.rows[i].UsedBytes = used
			b.rows[i].ObjectCount = count
		}
	}
	return nil
}

// Stub methods (BucketReconciler does not call them).
func (b *reconcileFakeBuckets) FindByID(context.Context, string) (*ossmodel.Bucket, error) {
	return nil, nil
}
func (b *reconcileFakeBuckets) FindByOwnerName(context.Context, string, string) (*ossmodel.Bucket, error) {
	return nil, nil
}
func (b *reconcileFakeBuckets) ListByOwner(context.Context, string) ([]ossmodel.Bucket, error) {
	return nil, nil
}
func (b *reconcileFakeBuckets) Create(context.Context, *ossmodel.Bucket) error { return nil }
func (b *reconcileFakeBuckets) EnsureSystem(context.Context, string, ossmodel.SystemBucketSpec) (*ossmodel.Bucket, error) {
	return nil, nil
}
func (b *reconcileFakeBuckets) AddUsage(context.Context, string, int64) error { return nil }
func (b *reconcileFakeBuckets) UpdatePolicy(context.Context, string, ossrepo.BucketPolicyUpdate) error {
	return nil
}
func (b *reconcileFakeBuckets) Delete(context.Context, string, bool) error { return nil }

// reconcileFakeFiles supplies SumByBucket; the other FileRepository
// methods are unused stubs.
type reconcileFakeFiles struct {
	sumByID  map[string]reconcileSum
	sumErr   error
	queriedFor []string
}

type reconcileSum struct{ Bytes, Count int64 }

func (f *reconcileFakeFiles) SumByBucket(_ context.Context, id string) (int64, int64, error) {
	f.queriedFor = append(f.queriedFor, id)
	if f.sumErr != nil {
		return 0, 0, f.sumErr
	}
	if v, ok := f.sumByID[id]; ok {
		return v.Bytes, v.Count, nil
	}
	return 0, 0, nil
}

// Unused FileRepository methods.
func (f *reconcileFakeFiles) Create(context.Context, *ossmodel.FileMeta) error          { return nil }
func (f *reconcileFakeFiles) FindByKey(context.Context, string) (*ossmodel.FileMeta, error) { return nil, nil }
func (f *reconcileFakeFiles) FindByOwnerKey(context.Context, string, string) (*ossmodel.FileMeta, error) {
	return nil, nil
}
func (f *reconcileFakeFiles) FindByOwnerKeyIncludeDeleted(context.Context, string, string) (*ossmodel.FileMeta, error) {
	return nil, nil
}
func (f *reconcileFakeFiles) Restore(context.Context, string, time.Time, *time.Time) error { return nil }
func (f *reconcileFakeFiles) MarkDeleted(context.Context, string, time.Time) error          { return nil }
func (f *reconcileFakeFiles) Patch(context.Context, string, ossrepo.FilePatch, time.Time) error {
	return nil
}
func (f *reconcileFakeFiles) ListByOwner(context.Context, string, ossrepo.ListByOwnerFilter, int, int) ([]ossmodel.FileMeta, int64, error) {
	return nil, 0, nil
}
func (f *reconcileFakeFiles) ListExpired(context.Context, time.Time, int) ([]ossmodel.FileMeta, error) {
	return nil, nil
}

func TestBucketReconciler_NewValidates(t *testing.T) {
	cases := []struct {
		name string
		cfg  BucketReconcilerConfig
	}{
		{"no buckets", BucketReconcilerConfig{Files: &reconcileFakeFiles{}, Audit: &recordingAudit{}}},
		{"no files", BucketReconcilerConfig{Buckets: &reconcileFakeBuckets{}, Audit: &recordingAudit{}}},
		{"no audit", BucketReconcilerConfig{Buckets: &reconcileFakeBuckets{}, Files: &reconcileFakeFiles{}}},
	}
	for _, c := range cases {
		if _, err := NewBucketReconciler(c.cfg); err == nil {
			t.Errorf("%s: expected validation error", c.name)
		}
	}
}

func TestBucketReconciler_RewritesOnDriftAndAudits(t *testing.T) {
	buckets := &reconcileFakeBuckets{
		rows: []ossmodel.Bucket{
			// Bucket A has ~10% byte drift AND a count drift -> rewrite.
			{ID: "bk_a", UsedBytes: 1000, ObjectCount: 5},
			// Bucket B is exactly correct -> no rewrite.
			{ID: "bk_b", UsedBytes: 500, ObjectCount: 2},
			// Bucket C has tiny byte drift (well under 1%) but count is correct -> no rewrite.
			{ID: "bk_c", UsedBytes: 1_000_000, ObjectCount: 10},
		},
	}
	files := &reconcileFakeFiles{
		sumByID: map[string]reconcileSum{
			"bk_a": {Bytes: 1100, Count: 6},     // both drift
			"bk_b": {Bytes: 500, Count: 2},      // exact
			"bk_c": {Bytes: 1_000_002, Count: 10}, // 2 bytes < 0.001 * 1e6 + 1
		},
	}
	audit := &recordingAudit{}

	rec, err := NewBucketReconciler(BucketReconcilerConfig{
		Buckets: buckets, Files: files, Audit: audit,
		DriftPermille: 10, // 1%
	})
	if err != nil {
		t.Fatalf("NewBucketReconciler: %v", err)
	}
	if err := rec.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if len(buckets.setCalls) != 1 {
		t.Fatalf("expected exactly 1 SetUsage (only bk_a should drift), got %d (%+v)",
			len(buckets.setCalls), buckets.setCalls)
	}
	got := buckets.setCalls[0]
	if got.BucketID != "bk_a" || got.UsedBytes != 1100 || got.ObjectCount != 6 {
		t.Errorf("SetUsage args: got %+v, want bk_a/1100/6", got)
	}

	rows := audit.snapshot()
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row for the drift correction, got %d", len(rows))
	}
	if rows[0].Action != ossmodel.AuditActionWorkerRun {
		t.Errorf("audit action: want worker_run, got %q", rows[0].Action)
	}
	if rows[0].Outcome != ossmodel.AuditOutcomeOK {
		t.Errorf("audit outcome: want ok, got %q", rows[0].Outcome)
	}
	if rows[0].BucketID != "bk_a" {
		t.Errorf("audit bucket id: want bk_a, got %q", rows[0].BucketID)
	}
	if !strings.HasPrefix(rows[0].Reason, "reconcile_drift") {
		t.Errorf("audit reason should mark drift: got %q", rows[0].Reason)
	}
}

func TestBucketReconciler_CountDriftAlwaysRewrites(t *testing.T) {
	// Even when bytes match perfectly, a count mismatch must
	// trigger a rewrite — drift on integer counts is always a
	// bug.
	buckets := &reconcileFakeBuckets{
		rows: []ossmodel.Bucket{{ID: "bk_x", UsedBytes: 100, ObjectCount: 1}},
	}
	files := &reconcileFakeFiles{
		sumByID: map[string]reconcileSum{"bk_x": {Bytes: 100, Count: 2}},
	}
	rec, _ := NewBucketReconciler(BucketReconcilerConfig{
		Buckets: buckets, Files: files, Audit: &recordingAudit{},
	})
	if err := rec.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if len(buckets.setCalls) != 1 {
		t.Fatalf("expected 1 SetUsage, got %d", len(buckets.setCalls))
	}
	if buckets.setCalls[0].ObjectCount != 2 {
		t.Errorf("SetUsage count: got %d, want 2", buckets.setCalls[0].ObjectCount)
	}
}

func TestBucketReconciler_SumErrorAuditedAndContinues(t *testing.T) {
	buckets := &reconcileFakeBuckets{
		rows: []ossmodel.Bucket{
			{ID: "bk_a", UsedBytes: 100},
			{ID: "bk_b", UsedBytes: 200},
		},
	}
	files := &reconcileFakeFiles{sumErr: errors.New("db down")}
	audit := &recordingAudit{}
	rec, _ := NewBucketReconciler(BucketReconcilerConfig{
		Buckets: buckets, Files: files, Audit: audit,
	})
	if err := rec.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce should swallow per-row failures: %v", err)
	}
	if len(buckets.setCalls) != 0 {
		t.Errorf("no rewrites expected when sum fails")
	}
	rows := audit.snapshot()
	errCount := 0
	for _, r := range rows {
		if r.Outcome == ossmodel.AuditOutcomeError {
			errCount++
		}
	}
	if errCount != 2 {
		t.Errorf("expected 2 error audit rows (one per bucket), got %d (%+v)", errCount, rows)
	}
}

func TestBucketReconciler_ListAllErrorBubbles(t *testing.T) {
	buckets := &reconcileFakeBuckets{listErr: errors.New("table missing")}
	rec, _ := NewBucketReconciler(BucketReconcilerConfig{
		Buckets: buckets,
		Files:   &reconcileFakeFiles{},
		Audit:   &recordingAudit{},
	})
	if err := rec.RunOnce(context.Background()); err == nil {
		t.Fatalf("ListAll error should propagate")
	}
}

func TestAcceptableByteDrift(t *testing.T) {
	cases := []struct {
		name     string
		cached   int64
		permille int
		want     int64
	}{
		{"empty bucket", 0, 10, 0},
		{"tiny bucket", 50, 10, 1},     // ceil to 1 byte
		{"normal bucket", 1_000_000, 10, 10_000},
		{"high tolerance", 1_000_000, 50, 50_000},
	}
	for _, c := range cases {
		got := acceptableByteDrift(c.cached, c.permille)
		if got != c.want {
			t.Errorf("%s: acceptableByteDrift(%d,%d)=%d, want %d",
				c.name, c.cached, c.permille, got, c.want)
		}
	}
}
