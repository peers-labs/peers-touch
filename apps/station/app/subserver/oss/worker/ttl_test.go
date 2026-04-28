package worker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// ---------------------------------------------------------------------------
// In-memory fakes for the TTLSweeper deps. Each is the smallest
// shape that satisfies the corresponding interface; we deliberately
// do NOT pull in the service-layer fakes to keep this file
// dependency-free.
// ---------------------------------------------------------------------------

type fakeFiles struct {
	mu      sync.Mutex
	rows    map[string]*ossmodel.FileMeta
	deleted []string

	listErr      error
	markDelErr   error
	markDelTwice bool
}

func newFakeFiles() *fakeFiles { return &fakeFiles{rows: map[string]*ossmodel.FileMeta{}} }

func (f *fakeFiles) seed(rows ...*ossmodel.FileMeta) {
	for _, r := range rows {
		f.rows[r.ID] = r
	}
}

func (f *fakeFiles) ListExpired(_ context.Context, now time.Time, limit int) ([]ossmodel.FileMeta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]ossmodel.FileMeta, 0)
	for _, r := range f.rows {
		if r.DeletedAt != nil {
			continue
		}
		if r.ExpiresAt == nil || !r.ExpiresAt.Before(now) {
			continue
		}
		out = append(out, *r)
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeFiles) MarkDeleted(_ context.Context, id string, now time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.markDelErr != nil {
		return f.markDelErr
	}
	r, ok := f.rows[id]
	if !ok {
		return ossrepo.ErrFileNotFound
	}
	if r.DeletedAt != nil {
		if f.markDelTwice {
			return ossrepo.ErrFileAlreadyDeleted
		}
		return nil
	}
	t := now
	r.DeletedAt = &t
	r.UpdatedAt = now
	f.deleted = append(f.deleted, id)
	return nil
}

// Unused interface methods — TTLSweeper does not call them. We
// implement no-ops so fakeFiles satisfies ossrepo.FileRepository.
func (f *fakeFiles) Create(context.Context, *ossmodel.FileMeta) error                           { return nil }
func (f *fakeFiles) FindByKey(context.Context, string) (*ossmodel.FileMeta, error)              { return nil, nil }
func (f *fakeFiles) FindByOwnerKey(context.Context, string, string) (*ossmodel.FileMeta, error) { return nil, nil }
func (f *fakeFiles) FindByOwnerKeyIncludeDeleted(context.Context, string, string) (*ossmodel.FileMeta, error) {
	return nil, nil
}
func (f *fakeFiles) Restore(context.Context, string, time.Time, *time.Time) error { return nil }
func (f *fakeFiles) Patch(context.Context, string, ossrepo.FilePatch, time.Time) error {
	return nil
}
func (f *fakeFiles) ListByOwner(context.Context, string, ossrepo.ListByOwnerFilter, int, int) ([]ossmodel.FileMeta, int64, error) {
	return nil, 0, nil
}

type fakeBuckets struct {
	debits map[string]int64
	err    error
}

func newFakeBuckets() *fakeBuckets { return &fakeBuckets{debits: map[string]int64{}} }

func (b *fakeBuckets) AddUsage(_ context.Context, bucketID string, delta int64) error {
	if b.err != nil {
		return b.err
	}
	b.debits[bucketID] += delta
	return nil
}
func (b *fakeBuckets) FindByID(context.Context, string) (*ossmodel.Bucket, error) { return nil, nil }
func (b *fakeBuckets) FindByOwnerName(context.Context, string, string) (*ossmodel.Bucket, error) {
	return nil, nil
}
func (b *fakeBuckets) ListByOwner(context.Context, string) ([]ossmodel.Bucket, error) {
	return nil, nil
}
func (b *fakeBuckets) ListAll(context.Context) ([]ossmodel.Bucket, error)      { return nil, nil }
func (b *fakeBuckets) Create(context.Context, *ossmodel.Bucket) error          { return nil }
func (b *fakeBuckets) EnsureSystem(context.Context, string, ossmodel.SystemBucketSpec) (*ossmodel.Bucket, error) {
	return nil, nil
}
func (b *fakeBuckets) UpdatePolicy(context.Context, string, ossrepo.BucketPolicyUpdate) error {
	return nil
}
func (b *fakeBuckets) Delete(context.Context, string, bool) error { return nil }

type fakeBlobs struct {
	releases map[string]int
	releaseErr error
}

func newFakeBlobs() *fakeBlobs { return &fakeBlobs{releases: map[string]int{}} }

func (b *fakeBlobs) Touch(context.Context, string, string, int64, string) (*ossmodel.Blob, error) {
	return nil, nil
}
func (b *fakeBlobs) Release(_ context.Context, _ string, key string) (int64, bool, error) {
	if b.releaseErr != nil {
		return 0, false, b.releaseErr
	}
	b.releases[key]++
	return 0, true, nil
}
func (b *fakeBlobs) Get(context.Context, string, string) (*ossmodel.Blob, error) { return nil, nil }
func (b *fakeBlobs) ListGCCandidates(context.Context, time.Time, int) ([]ossmodel.Blob, error) {
	return nil, nil
}
func (b *fakeBlobs) Delete(context.Context, string, string) error { return nil }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestTTLSweeper_NewRequiresDeps(t *testing.T) {
	cases := []struct {
		name string
		cfg  TTLSweeperConfig
	}{
		{"no files", TTLSweeperConfig{Audit: &recordingAudit{}, BackendName: "local"}},
		{"no audit", TTLSweeperConfig{Files: newFakeFiles(), BackendName: "local"}},
		{"no backend name", TTLSweeperConfig{Files: newFakeFiles(), Audit: &recordingAudit{}}},
	}
	for _, c := range cases {
		if _, err := NewTTLSweeper(c.cfg); err == nil {
			t.Errorf("%s: expected validation error", c.name)
		}
	}
}

func TestTTLSweeper_RunOnce_DeletesExpiredAndAudits(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	yesterday := now.Add(-24 * time.Hour)
	tomorrow := now.Add(24 * time.Hour)

	files := newFakeFiles()
	files.seed(
		// Expired — should be swept.
		&ossmodel.FileMeta{ID: "f-1", Key: "k1", BucketID: "b1", OwnerActorID: "a", Size: 100, ExpiresAt: &yesterday},
		// Not expired — left alone.
		&ossmodel.FileMeta{ID: "f-2", Key: "k2", BucketID: "b1", OwnerActorID: "a", Size: 50, ExpiresAt: &tomorrow},
		// No expiry → never reaped.
		&ossmodel.FileMeta{ID: "f-3", Key: "k3", BucketID: "b1", OwnerActorID: "a", Size: 25, ExpiresAt: nil},
	)
	buckets := newFakeBuckets()
	blobs := newFakeBlobs()
	audit := &recordingAudit{}

	sweeper, err := NewTTLSweeper(TTLSweeperConfig{
		Files:       files,
		Buckets:     buckets,
		Blobs:       blobs,
		Audit:       audit,
		BackendName: "local",
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewTTLSweeper: %v", err)
	}
	if err := sweeper.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// f-1 must be soft-deleted; the others left untouched.
	if files.rows["f-1"].DeletedAt == nil {
		t.Errorf("f-1 should be soft-deleted")
	}
	if files.rows["f-2"].DeletedAt != nil {
		t.Errorf("f-2 should NOT be deleted (not expired): %+v", files.rows["f-2"])
	}
	if files.rows["f-3"].DeletedAt != nil {
		t.Errorf("f-3 should NOT be deleted (no expires_at): %+v", files.rows["f-3"])
	}

	// Bucket usage debited by exactly the expired file's size.
	if got := buckets.debits["b1"]; got != -100 {
		t.Errorf("bucket b1 debit: want -100, got %d", got)
	}

	// Blob refcount released for the expired file's key.
	if blobs.releases["k1"] != 1 {
		t.Errorf("blob k1 release count: %d", blobs.releases["k1"])
	}

	// One audit row per soft-delete with reason="ttl".
	rows := audit.snapshot()
	if len(rows) != 1 {
		t.Fatalf("audit rows: want 1, got %d (%+v)", len(rows), rows)
	}
	r := rows[0]
	if r.Action != ossmodel.AuditActionDelete || r.Outcome != ossmodel.AuditOutcomeOK || r.Reason != "ttl" {
		t.Errorf("audit row mismatch: %+v", r)
	}
	if r.FileID != "f-1" || r.FileKey != "k1" || r.SizeBytes != 100 || r.ActorID != "a" {
		t.Errorf("audit row payload mismatch: %+v", r)
	}
}

func TestTTLSweeper_LostRaceIsBenign(t *testing.T) {
	// MarkDeleted returns ErrFileAlreadyDeleted — must NOT
	// double-debit, must NOT release, must NOT audit.
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	yesterday := now.Add(-1 * time.Hour)
	files := newFakeFiles()
	files.seed(&ossmodel.FileMeta{ID: "f-1", Key: "k1", BucketID: "b1", Size: 10, ExpiresAt: &yesterday})
	files.markDelErr = ossrepo.ErrFileAlreadyDeleted
	buckets := newFakeBuckets()
	blobs := newFakeBlobs()
	audit := &recordingAudit{}

	sweeper, _ := NewTTLSweeper(TTLSweeperConfig{
		Files:       files,
		Buckets:     buckets,
		Blobs:       blobs,
		Audit:       audit,
		BackendName: "local",
		Now:         func() time.Time { return now },
	})
	if err := sweeper.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if buckets.debits["b1"] != 0 {
		t.Errorf("lost-race must NOT debit; got %d", buckets.debits["b1"])
	}
	if blobs.releases["k1"] != 0 {
		t.Errorf("lost-race must NOT release; got %d", blobs.releases["k1"])
	}
	if len(audit.snapshot()) != 0 {
		t.Errorf("lost-race must NOT audit")
	}
}

func TestTTLSweeper_ListExpiredErrorPropagates(t *testing.T) {
	files := newFakeFiles()
	files.listErr = errors.New("db down")
	sweeper, _ := NewTTLSweeper(TTLSweeperConfig{
		Files:       files,
		Audit:       &recordingAudit{},
		BackendName: "local",
	})
	if err := sweeper.RunOnce(context.Background()); err == nil {
		t.Fatalf("ListExpired error should propagate")
	}
}
