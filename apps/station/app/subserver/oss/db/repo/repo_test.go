package repo

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// In-memory store fixture
// ---------------------------------------------------------------------------

// mockStore is a process-global Store implementation backed by a single
// shared sqlite handle. The repo packages resolve the DB via
// store.GetRDS, which in turn calls Store.RDS — so tests have to wire
// this once per test binary.
type mockStore struct {
	db *gorm.DB
}

func (m *mockStore) Init(ctx context.Context, opts ...option.Option) error { return nil }
func (m *mockStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
	return m.db, nil
}
func (m *mockStore) Name() string { return "repo-test-store" }

var (
	storeOnce sync.Once
	sharedDB  *gorm.DB
	storeErr  error
)

// initStore wires sqlite ":memory:" once per test binary and migrates
// the schema. Subsequent test files share the handle. Each test
// truncates the tables it touches at the top so suites stay
// independent.
func initStore(t *testing.T) *gorm.DB {
	t.Helper()
	storeOnce.Do(func() {
		// `cache=shared` lets concurrent goroutines in the same
		// process see the same data; we still serialise writes
		// inside our test fixtures so the implicit sqlite write
		// lock does not surface as a flake.
		sharedDB, storeErr = gorm.Open(sqlite.Open("file:repotest?mode=memory&cache=shared"), &gorm.Config{})
		if storeErr != nil {
			return
		}
		storeErr = sharedDB.AutoMigrate(
			&ossmodel.FileMeta{},
			&ossmodel.Bucket{},
			&ossmodel.Audit{},
			&ossmodel.Meta{},
		)
		if storeErr != nil {
			return
		}
		// InjectStore returns ErrStoreAlreadyInjected on re-runs;
		// silently ignore so test packages can share the handle.
		_ = store.InjectStore(context.Background(), &mockStore{db: sharedDB})
	})
	if storeErr != nil {
		t.Fatalf("init store: %v", storeErr)
	}
	return sharedDB
}

// reset truncates every table the repo tests touch. We use Exec
// instead of gorm's `Unscoped().Where(...).Delete(...)` because
// sqlite handles a bare `DELETE FROM` more cleanly across the
// shared cache.
func reset(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, table := range []string{"oss_files", "oss_buckets", "oss_audit", "oss_meta"} {
		if err := db.Exec("DELETE FROM " + table).Error; err != nil {
			t.Fatalf("reset %s: %v", table, err)
		}
	}
}

// ---------------------------------------------------------------------------
// BucketRepository tests
// ---------------------------------------------------------------------------

func TestBucketRepo_EnsureSystemIsIdempotent(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()
	actor := "did:test:alice"

	first, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpecs[1]) // chat
	if err != nil {
		t.Fatalf("ensure first: %v", err)
	}
	if first.OwnerActorID != actor || first.Name != ossmodel.SystemBucketChat {
		t.Fatalf("unexpected first row: %+v", first)
	}

	second, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpecs[1])
	if err != nil {
		t.Fatalf("ensure second: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected same ID on idempotent call; got %s != %s", first.ID, second.ID)
	}

	// Sanity: only one row per (owner, name).
	var count int64
	if err := db.Model(&ossmodel.Bucket{}).
		Where("owner_actor_id = ? AND name = ?", actor, ossmodel.SystemBucketChat).
		Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 row, got %d", count)
	}
}

func TestBucketRepo_AddUsage_RespectsQuota(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()
	actor := "did:test:bob"

	b, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpec{
		Name:              "tight",
		Kind:              ossmodel.BucketKindUser,
		DefaultVisibility: ossmodel.VisibilityPrivate,
		QuotaBytes:        100,
	})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}

	if err := r.AddUsage(ctx, b.ID, 80); err != nil {
		t.Fatalf("first add: %v", err)
	}
	// 80 + 25 > 100 → quota exceeded, row untouched.
	if err := r.AddUsage(ctx, b.ID, 25); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("expected ErrQuotaExceeded, got %v", err)
	}
	// Verify state did not advance past 80.
	var got ossmodel.Bucket
	if err := db.Where("id = ?", b.ID).First(&got).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.UsedBytes != 80 || got.ObjectCount != 1 {
		t.Fatalf("quota leak: used=%d count=%d", got.UsedBytes, got.ObjectCount)
	}
	// Negative delta should always succeed (delete path).
	if err := r.AddUsage(ctx, b.ID, -80); err != nil {
		t.Fatalf("decrement: %v", err)
	}
	if err := db.Where("id = ?", b.ID).First(&got).Error; err != nil {
		t.Fatalf("reload2: %v", err)
	}
	if got.UsedBytes != 0 || got.ObjectCount != 0 {
		t.Fatalf("decrement leak: used=%d count=%d", got.UsedBytes, got.ObjectCount)
	}
}

func TestBucketRepo_AddUsage_UnknownBucketReturnsNotFound(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	if err := r.AddUsage(context.Background(), "nope", 1); !errors.Is(err, ErrBucketNotFound) {
		t.Fatalf("expected ErrBucketNotFound, got %v", err)
	}
	// Bucket count should still be zero.
	var n int64
	_ = db.Model(&ossmodel.Bucket{}).Count(&n)
	if n != 0 {
		t.Fatalf("unexpected rows: %d", n)
	}
}

func TestBucketRepo_DeleteRefusesNonEmptyWithoutForce(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()
	actor := "did:test:carol"

	b, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpecs[2]) // personal
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if err := r.AddUsage(ctx, b.ID, 1024); err != nil {
		t.Fatalf("usage: %v", err)
	}
	if err := r.Delete(ctx, b.ID, false); !errors.Is(err, ErrBucketNotEmpty) {
		t.Fatalf("expected ErrBucketNotEmpty, got %v", err)
	}
	// Force succeeds.
	if err := r.Delete(ctx, b.ID, true); err != nil {
		t.Fatalf("force delete: %v", err)
	}
	if _, err := r.FindByID(ctx, b.ID); !errors.Is(err, ErrBucketNotFound) {
		t.Fatalf("expected ErrBucketNotFound after delete, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// AuditRepository tests
// ---------------------------------------------------------------------------

func TestAuditRepo_AppendQueryTrim(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewAuditRepository("default")
	ctx := context.Background()

	now := time.Now()
	for i := 0; i < 5; i++ {
		err := r.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionUpload,
			ActorID: "did:test:logger",
			TS:      now.Add(-time.Duration(i) * time.Hour),
			Outcome: ossmodel.AuditOutcomeOK,
			SizeBytes: int64(i + 1),
		})
		if err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}

	rows, total, err := r.Query(ctx, AuditQuery{ActorID: "did:test:logger"})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if total != 5 || len(rows) != 5 {
		t.Fatalf("expected 5 rows, got %d total / %d returned", total, len(rows))
	}
	// Order: newest first.
	if rows[0].TS.Before(rows[4].TS) {
		t.Fatalf("expected DESC order on TS")
	}

	cut := now.Add(-2*time.Hour - time.Minute)
	deleted, err := r.Trim(ctx, cut)
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if deleted == 0 {
		t.Fatalf("expected trim to delete at least one row")
	}

	_, total, _ = r.Query(ctx, AuditQuery{ActorID: "did:test:logger"})
	if total >= 5 {
		t.Fatalf("trim did not reduce row count: total=%d", total)
	}
}

// ---------------------------------------------------------------------------
// Bootstrap tests
// ---------------------------------------------------------------------------

func TestBootstrap_SeedsSystemBucketsAndIsIdempotent(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	res, err := Bootstrap(context.Background(), BootstrapDeps{
		DBName:      "default",
		ExtraActors: []string{"did:test:dave", "did:test:eve"},
	})
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if res.Skipped {
		t.Fatalf("first run should not skip")
	}

	// Each known actor (dave, eve, _legacy) gets the 3 system buckets.
	expectedActors := 3
	expectedBuckets := expectedActors * len(ossmodel.SystemBucketSpecs)
	var n int64
	if err := db.Model(&ossmodel.Bucket{}).Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != int64(expectedBuckets) {
		t.Fatalf("expected %d buckets, got %d", expectedBuckets, n)
	}

	// Second run should be a no-op short-circuited via meta.
	res2, err := Bootstrap(context.Background(), BootstrapDeps{
		DBName:      "default",
		ExtraActors: []string{"did:test:dave"},
	})
	if !errors.Is(err, ErrAlreadyBootstrapped) {
		t.Fatalf("expected ErrAlreadyBootstrapped, got %v", err)
	}
	if res2 == nil || !res2.Skipped {
		t.Fatalf("expected Skipped result on idempotent run")
	}
	// Bucket count unchanged.
	if err := db.Model(&ossmodel.Bucket{}).Count(&n).Error; err != nil {
		t.Fatalf("recount: %v", err)
	}
	if n != int64(expectedBuckets) {
		t.Fatalf("idempotency leaked rows: now %d", n)
	}
}

func TestBootstrap_BackfillsLegacyOrphanFiles(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	// Pre-seed a legacy oss_files row that has no owner / bucket /
	// visibility — this simulates v1 data.
	pre := &ossmodel.FileMeta{
		ID:      "f1",
		Key:     "abc123",
		Name:    "old.bin",
		Size:    42,
		Backend: "local",
		Path:    "abc123",
	}
	if err := db.Create(pre).Error; err != nil {
		t.Fatalf("seed legacy file: %v", err)
	}

	if _, err := Bootstrap(context.Background(), BootstrapDeps{DBName: "default"}); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	var got ossmodel.FileMeta
	if err := db.Where("id = ?", "f1").First(&got).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.OwnerActorID != ossmodel.LegacyOwnerActorID {
		t.Fatalf("expected legacy owner sentinel, got %q", got.OwnerActorID)
	}
	if got.Visibility != ossmodel.VisibilityChat {
		t.Fatalf("expected chat visibility, got %q", got.Visibility)
	}
	if got.BucketID == "" {
		t.Fatalf("expected bucket assigned, got empty")
	}
	// And the legacy actor's chat bucket should have one file
	// reconciled into it.
	var legacyChat ossmodel.Bucket
	if err := db.Where("owner_actor_id = ? AND name = ?",
		ossmodel.LegacyOwnerActorID, ossmodel.SystemBucketChat).First(&legacyChat).Error; err != nil {
		t.Fatalf("legacy chat bucket: %v", err)
	}
	if legacyChat.ObjectCount != 1 || legacyChat.UsedBytes != 42 {
		t.Fatalf("usage not reconciled: count=%d used=%d", legacyChat.ObjectCount, legacyChat.UsedBytes)
	}
}
