package worker

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

// gcFakeBlobs extends fakeBlobs with the candidate listing the GC
// worker depends on. We keep this struct local to the gc tests so
// the TTLSweeper fakes stay focused on the release path.
type gcFakeBlobs struct {
	*fakeBlobs

	candidates []ossmodel.Blob
	listErr    error

	deleted []string
	delErr  error
}

func newGCFakeBlobs() *gcFakeBlobs { return &gcFakeBlobs{fakeBlobs: newFakeBlobs()} }

func (b *gcFakeBlobs) ListGCCandidates(_ context.Context, _ time.Time, limit int) ([]ossmodel.Blob, error) {
	if b.listErr != nil {
		return nil, b.listErr
	}
	out := append([]ossmodel.Blob{}, b.candidates...)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (b *gcFakeBlobs) Delete(_ context.Context, _, key string) error {
	if b.delErr != nil {
		return b.delErr
	}
	b.deleted = append(b.deleted, key)
	return nil
}

// stubBackend implements storage.Backend's Delete with configurable
// behaviour. Other Backend methods panic — they are not invoked
// from the GC code path.
type stubBackend struct {
	deleted []string
	delErr  error
}

func (s *stubBackend) Save(context.Context, string, io.Reader) (string, error) { panic("unused") }
func (s *stubBackend) Open(context.Context, string, *storage.Range) (io.ReadCloser, int64, string, error) {
	panic("unused")
}
func (s *stubBackend) Stat(context.Context, string) (*storage.StatInfo, error) { panic("unused") }
func (s *stubBackend) Healthz(context.Context) error                           { return nil }
func (s *stubBackend) Delete(_ context.Context, key string) error {
	if s.delErr != nil {
		return s.delErr
	}
	s.deleted = append(s.deleted, key)
	return nil
}

func TestBlobGC_NewRequiresDeps(t *testing.T) {
	cases := []struct {
		name string
		cfg  BlobGCConfig
	}{
		{"no blobs", BlobGCConfig{Backend: &stubBackend{}, Audit: &recordingAudit{}, BackendName: "local"}},
		{"no backend", BlobGCConfig{Blobs: newGCFakeBlobs(), Audit: &recordingAudit{}, BackendName: "local"}},
		{"no audit", BlobGCConfig{Blobs: newGCFakeBlobs(), Backend: &stubBackend{}, BackendName: "local"}},
		{"no backend name", BlobGCConfig{Blobs: newGCFakeBlobs(), Backend: &stubBackend{}, Audit: &recordingAudit{}}},
	}
	for _, c := range cases {
		if _, err := NewBlobGC(c.cfg); err == nil {
			t.Errorf("%s: expected validation error", c.name)
		}
	}
}

func TestBlobGC_RunOnce_DeletesCandidatesAndAudits(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	old := now.Add(-48 * time.Hour)

	blobs := newGCFakeBlobs()
	blobs.candidates = []ossmodel.Blob{
		{Backend: "local", Key: "k1", Size: 100, RefCount: 0, LastSeenAt: old},
		{Backend: "local", Key: "k2", Size: 200, RefCount: 0, LastSeenAt: old},
		// Different backend → must be skipped (defensive guard).
		{Backend: "s3", Key: "k3", Size: 300, RefCount: 0, LastSeenAt: old},
	}
	backend := &stubBackend{}
	audit := &recordingAudit{}

	gc, err := NewBlobGC(BlobGCConfig{
		Blobs:       blobs,
		Backend:     backend,
		Audit:       audit,
		BackendName: "local",
		Grace:       24 * time.Hour,
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewBlobGC: %v", err)
	}
	if err := gc.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// Backend deletes match the local-backend candidates only.
	wantDeleted := map[string]bool{"k1": true, "k2": true}
	if len(backend.deleted) != 2 {
		t.Fatalf("backend.deleted: want 2, got %v", backend.deleted)
	}
	for _, k := range backend.deleted {
		if !wantDeleted[k] {
			t.Errorf("unexpected backend delete: %q", k)
		}
	}
	// k3 (s3 backend) must not be touched by either path.
	for _, k := range blobs.deleted {
		if k == "k3" {
			t.Errorf("s3-backend candidate should be skipped, got blob row delete for k3")
		}
	}
	if len(blobs.deleted) != 2 {
		t.Errorf("blob row delete count: want 2, got %d (%v)", len(blobs.deleted), blobs.deleted)
	}

	rows := audit.snapshot()
	okRows := 0
	for _, r := range rows {
		if r.Action != ossmodel.AuditActionBlobGC {
			t.Errorf("audit action: want %q, got %q", ossmodel.AuditActionBlobGC, r.Action)
		}
		if r.Outcome == ossmodel.AuditOutcomeOK && r.Reason == "ref_zero" {
			okRows++
		}
	}
	if okRows != 2 {
		t.Errorf("expected 2 ref_zero audit rows, got %d (%+v)", okRows, rows)
	}
}

func TestBlobGC_BackendDeleteFailureAuditedAndContinues(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	old := now.Add(-48 * time.Hour)

	blobs := newGCFakeBlobs()
	blobs.candidates = []ossmodel.Blob{
		{Backend: "local", Key: "k1", Size: 100, LastSeenAt: old},
	}
	backend := &stubBackend{delErr: errors.New("io error")}
	audit := &recordingAudit{}

	gc, _ := NewBlobGC(BlobGCConfig{
		Blobs:       blobs,
		Backend:     backend,
		Audit:       audit,
		BackendName: "local",
		Grace:       24 * time.Hour,
		Now:         func() time.Time { return now },
	})
	if err := gc.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce should swallow per-row failures: %v", err)
	}
	if len(blobs.deleted) != 0 {
		t.Errorf("blob row should NOT be deleted when backend.Delete fails")
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row, got %+v", rows)
	}
}

func TestBlobGC_RowDeleteFailureAuditedSeparately(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	old := now.Add(-48 * time.Hour)

	blobs := newGCFakeBlobs()
	blobs.candidates = []ossmodel.Blob{
		{Backend: "local", Key: "k1", Size: 100, LastSeenAt: old},
	}
	blobs.delErr = errors.New("table locked")
	backend := &stubBackend{}
	audit := &recordingAudit{}

	gc, _ := NewBlobGC(BlobGCConfig{
		Blobs:       blobs,
		Backend:     backend,
		Audit:       audit,
		BackendName: "local",
		Grace:       24 * time.Hour,
		Now:         func() time.Time { return now },
	})
	if err := gc.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row for row delete failure, got %+v", rows)
	}
	if rows[0].Reason == "" {
		t.Errorf("error audit reason should be non-empty")
	}
}
