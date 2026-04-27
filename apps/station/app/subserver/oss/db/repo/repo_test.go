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
			&ossmodel.PeerKey{},
			&ossmodel.Blob{},
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
	for _, table := range []string{"oss_files", "oss_buckets", "oss_audit", "oss_meta", "oss_blobs", "oss_peer_keys"} {
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

func TestBucketRepo_Create_DuplicateReturnsErrBucketExists(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()
	actor := "did:test:dave"

	// Seed once via EnsureSystem (canonical path).
	if _, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpecs[0]); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// A direct Create with the same (owner, name) tuple must surface
	// ErrBucketExists rather than the raw GORM unique-constraint error
	// — service-layer handlers depend on this stable sentinel to map
	// 409 Conflict on the dashboard "Create bucket" endpoint.
	dup := &ossmodel.Bucket{
		ID:                "synthetic-dup",
		Name:              ossmodel.SystemBucketAvatar,
		OwnerActorID:      actor,
		Kind:              ossmodel.BucketKindUser,
		DefaultVisibility: ossmodel.VisibilityPublic,
	}
	if err := r.Create(ctx, dup); !errors.Is(err, ErrBucketExists) {
		t.Fatalf("expected ErrBucketExists, got %v", err)
	}

	// And we must not have leaked a second row.
	var n int64
	_ = db.Model(&ossmodel.Bucket{}).
		Where("owner_actor_id = ? AND name = ?", actor, ossmodel.SystemBucketAvatar).
		Count(&n)
	if n != 1 {
		t.Fatalf("expected exactly 1 row, got %d", n)
	}
}

func TestBucketRepo_UpdatePolicy(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()
	actor := "did:test:eve"

	b, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpecs[1]) // chat
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}

	// Patch only some columns. nil pointers must mean "leave alone";
	// zero values for set pointers must persist (TTLDays=0 = no TTL).
	newVis := ossmodel.VisibilityPrivate
	newQuota := int64(123456)
	zeroTTL := int32(0)
	if err := r.UpdatePolicy(ctx, b.ID, BucketPolicyUpdate{
		DefaultVisibility: &newVis,
		QuotaBytes:        &newQuota,
		TTLDays:           &zeroTTL,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err := r.FindByID(ctx, b.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.DefaultVisibility != newVis || got.QuotaBytes != newQuota || got.TTLDays != 0 {
		t.Fatalf("policy not applied: %+v", got)
	}
	// Description was not in the patch — must be unchanged.
	if got.Description != ossmodel.SystemBucketSpecs[1].Description {
		t.Fatalf("description leaked: want %q, got %q",
			ossmodel.SystemBucketSpecs[1].Description, got.Description)
	}

	// Unknown bucket → ErrBucketNotFound.
	if err := r.UpdatePolicy(ctx, "no-such", BucketPolicyUpdate{QuotaBytes: &newQuota}); !errors.Is(err, ErrBucketNotFound) {
		t.Fatalf("expected ErrBucketNotFound, got %v", err)
	}

	// Empty patch (only updated_at would change) is a no-op and
	// MUST NOT touch the row — operators can call PATCH with all
	// nil pointers as a "ping" without bumping updated_at.
	preTouch := got.UpdatedAt
	if err := r.UpdatePolicy(ctx, b.ID, BucketPolicyUpdate{}); err != nil {
		t.Fatalf("noop patch: %v", err)
	}
	post, _ := r.FindByID(ctx, b.ID)
	if !post.UpdatedAt.Equal(preTouch) {
		t.Fatalf("noop patch should not bump updated_at: pre=%v post=%v", preTouch, post.UpdatedAt)
	}
}

func TestBucketRepo_ListByOwnerAndAll(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()

	// Seed: alice has avatar+chat, bob has personal only.
	for _, actor := range []string{"did:test:alice", "did:test:bob"} {
		spec := ossmodel.SystemBucketSpecs[2] // personal
		if actor == "did:test:alice" {
			spec = ossmodel.SystemBucketSpecs[0] // avatar
			if _, err := r.EnsureSystem(ctx, actor, ossmodel.SystemBucketSpecs[1]); err != nil {
				t.Fatalf("seed alice chat: %v", err)
			}
		}
		if _, err := r.EnsureSystem(ctx, actor, spec); err != nil {
			t.Fatalf("seed %s: %v", actor, err)
		}
	}

	rows, err := r.ListByOwner(ctx, "did:test:alice")
	if err != nil {
		t.Fatalf("ListByOwner: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("alice should own 2 buckets, got %d: %+v", len(rows), rows)
	}
	for _, row := range rows {
		if row.OwnerActorID != "did:test:alice" {
			t.Fatalf("ListByOwner leaked owner %q", row.OwnerActorID)
		}
	}

	all, err := r.ListAll(ctx)
	if err != nil {
		t.Fatalf("ListAll: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("ListAll: want 3 buckets across both actors, got %d", len(all))
	}
	// Database-level sanity — the list and the COUNT must agree.
	var n int64
	_ = db.Model(&ossmodel.Bucket{}).Count(&n)
	if int(n) != len(all) {
		t.Fatalf("count drift: count=%d, list=%d", n, len(all))
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

func TestBootstrap_StampsSchemaVersionAndIsIdempotent(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	res, err := Bootstrap(context.Background(), BootstrapDeps{DBName: "default"})
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if res.Skipped {
		t.Fatalf("first run should not skip")
	}

	// Bootstrap is intentionally non-seeding: no buckets, no files
	// exist after a clean migration. System buckets are created
	// lazily by the upload-path service.
	var n int64
	if err := db.Model(&ossmodel.Bucket{}).Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 buckets after bootstrap, got %d", n)
	}

	// Schema version row should exist.
	var meta ossmodel.Meta
	if err := db.Where("key = ?", ossmodel.MetaKeySchemaVersion).First(&meta).Error; err != nil {
		t.Fatalf("schema version row: %v", err)
	}
	if meta.Value != ossmodel.SchemaVersionCurrent {
		t.Fatalf("expected schema_version=%s, got %s", ossmodel.SchemaVersionCurrent, meta.Value)
	}

	// capability_version is seeded on first reach to v3 — clients
	// rely on /capabilities surfacing a non-empty value, so absence
	// is a contract violation rather than a soft-default.
	var capMeta ossmodel.Meta
	if err := db.Where("key = ?", ossmodel.MetaKeyCapabilityVersion).First(&capMeta).Error; err != nil {
		t.Fatalf("capability_version row: %v", err)
	}
	if capMeta.Value == "" {
		t.Fatalf("capability_version should be a non-empty ULID")
	}
	seedCap := capMeta.Value

	// Second run short-circuits via the sentinel.
	res2, err := Bootstrap(context.Background(), BootstrapDeps{DBName: "default"})
	if !errors.Is(err, ErrAlreadyBootstrapped) {
		t.Fatalf("expected ErrAlreadyBootstrapped, got %v", err)
	}
	if res2 == nil || !res2.Skipped {
		t.Fatalf("expected Skipped result on idempotent run")
	}

	// Idempotent run must NOT churn capability_version — only
	// policy changes (PATCH visibility, key rotation) re-roll it.
	if err := db.Where("key = ?", ossmodel.MetaKeyCapabilityVersion).First(&capMeta).Error; err != nil {
		t.Fatalf("capability_version row after idempotent run: %v", err)
	}
	if capMeta.Value != seedCap {
		t.Fatalf("idempotent bootstrap should not change capability_version (%s -> %s)",
			seedCap, capMeta.Value)
	}
}

// ---------------------------------------------------------------------------
// PeerKeyRepository tests — local key persistence + TOFU pin.
// ---------------------------------------------------------------------------

func TestPeerKeyRepo_LocalKeyRoundtrip(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewPeerKeyRepository("default")
	ctx := context.Background()

	// Empty store reports the sentinel so the federation cache
	// knows to generate.
	if _, _, _, err := r.LoadLocalKey(ctx); !errors.Is(err, ErrNoLocalKey) {
		t.Fatalf("expected ErrNoLocalKey on empty store, got %v", err)
	}

	if err := r.SaveLocalKey(ctx, "PRIV-PEM", "PUB-PEM", "kid-x"); err != nil {
		t.Fatalf("save: %v", err)
	}

	priv, pub, kid, err := r.LoadLocalKey(ctx)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if priv != "PRIV-PEM" || pub != "PUB-PEM" || kid != "kid-x" {
		t.Fatalf("roundtrip mismatch: %q / %q / %q", priv, pub, kid)
	}

	// Save again under the same keys to confirm idempotency.
	if err := r.SaveLocalKey(ctx, "PRIV-PEM-2", "PUB-PEM-2", "kid-y"); err != nil {
		t.Fatalf("save 2: %v", err)
	}
	_, _, kid2, _ := r.LoadLocalKey(ctx)
	if kid2 != "kid-y" {
		t.Fatalf("overwrite kid lost: %q", kid2)
	}
}

func TestPeerKeyRepo_TOFUInsertThenMismatch(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewPeerKeyRepository("default")
	ctx := context.Background()

	// First sighting — TOFU insert.
	row := ossmodel.PeerKey{
		PeerStationID: "station-A",
		KID:           "kid-honest",
		PublicKeyPEM:  "PUB",
	}
	if err := r.UpsertTOFU(ctx, row); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	got, err := r.GetPeer(ctx, "station-A")
	if err != nil || got == nil || got.KID != "kid-honest" {
		t.Fatalf("after TOFU: row=%v err=%v", got, err)
	}

	// Same kid → success (touch only).
	if err := r.UpsertTOFU(ctx, row); err != nil {
		t.Fatalf("repeat upsert: %v", err)
	}

	// Different kid for the same peer → hard reject.
	bad := row
	bad.KID = "kid-mallory"
	bad.PublicKeyPEM = "PUB2"
	if err := r.UpsertTOFU(ctx, bad); !errors.Is(err, ErrPeerKeyMismatch) {
		t.Fatalf("expected ErrPeerKeyMismatch, got %v", err)
	}

	// After pinning, the same forged input must still fail with
	// the *pinned* sentinel — operators care about the distinction.
	if err := db.Model(&ossmodel.PeerKey{}).
		Where("peer_station_id = ?", "station-A").
		Update("pinned", true).Error; err != nil {
		t.Fatalf("pin: %v", err)
	}
	if err := r.UpsertTOFU(ctx, bad); !errors.Is(err, ErrPinnedKeyMismatch) {
		t.Fatalf("expected ErrPinnedKeyMismatch, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// BlobRepository tests — Touch / Release / GC candidate semantics.
// ---------------------------------------------------------------------------

func TestBlobRepo_TouchInsertsThenIncrementsRefCount(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBlobRepository("default")
	ctx := context.Background()

	// First Touch is an insert.
	row, err := r.Touch(ctx, "local", "cas/aa/abc", 42, "deadbeef")
	if err != nil {
		t.Fatalf("touch insert: %v", err)
	}
	if row.RefCount != 1 {
		t.Fatalf("expected ref_count=1 on insert, got %d", row.RefCount)
	}
	if row.Size != 42 || row.Sha256 != "deadbeef" {
		t.Fatalf("insert payload mismatch: %+v", row)
	}

	// Second Touch increments. Size + sha bytes are *not* mutated
	// on the increment path — same content, by definition.
	row2, err := r.Touch(ctx, "local", "cas/aa/abc", 999, "ignored")
	if err != nil {
		t.Fatalf("touch increment: %v", err)
	}
	if row2.RefCount != 2 {
		t.Fatalf("expected ref_count=2 after increment, got %d", row2.RefCount)
	}
	if row2.Size != 42 || row2.Sha256 != "deadbeef" {
		t.Fatalf("increment must not mutate size/sha: %+v", row2)
	}

	// Sanity: only one row exists in the table.
	var n int64
	if err := db.Model(&ossmodel.Blob{}).Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 blob row, got %d", n)
	}
}

func TestBlobRepo_ReleaseDecrementsToZeroAndStops(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBlobRepository("default")
	ctx := context.Background()
	if _, err := r.Touch(ctx, "local", "cas/bb/xyz", 7, "feedface"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// First Release — counter goes 1 -> 0, dropped flag fires.
	count, dropped, err := r.Release(ctx, "local", "cas/bb/xyz")
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if count != 0 || !dropped {
		t.Fatalf("first release: count=%d dropped=%v", count, dropped)
	}

	// Second Release — counter is already at zero. Behaviour:
	// returns (0, false, nil) — benign idempotent path.
	count, dropped, err = r.Release(ctx, "local", "cas/bb/xyz")
	if err != nil {
		t.Fatalf("second release: %v", err)
	}
	if count != 0 || dropped {
		t.Fatalf("second release should be a no-op: count=%d dropped=%v", count, dropped)
	}

	// Sanity: the row is still present (only the GC worker deletes
	// rows; Release just decrements).
	got, err := r.Get(ctx, "local", "cas/bb/xyz")
	if err != nil || got == nil {
		t.Fatalf("row gone after release: row=%v err=%v", got, err)
	}
}

func TestBlobRepo_ReleaseUnknownKeyReturnsErrBlobNotFound(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBlobRepository("default")
	_, _, err := r.Release(context.Background(), "local", "missing")
	if !errors.Is(err, ErrBlobNotFound) {
		t.Fatalf("expected ErrBlobNotFound, got %v", err)
	}
}

func TestBlobRepo_ListGCCandidatesFiltersByRefAndAge(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBlobRepository("default")
	ctx := context.Background()

	// Seed two rows with different refcount + last_seen_at.
	if _, err := r.Touch(ctx, "local", "cas/old/zero", 1, "h1"); err != nil {
		t.Fatalf("seed old: %v", err)
	}
	if _, err := r.Touch(ctx, "local", "cas/young/one", 1, "h2"); err != nil {
		t.Fatalf("seed young: %v", err)
	}
	// Drop the first to ref_count=0 and back-date its last_seen_at.
	if _, _, err := r.Release(ctx, "local", "cas/old/zero"); err != nil {
		t.Fatalf("release: %v", err)
	}
	pastTime := time.Now().Add(-48 * time.Hour)
	if err := db.Model(&ossmodel.Blob{}).
		Where("backend = ? AND key = ?", "local", "cas/old/zero").
		Update("last_seen_at", pastTime).Error; err != nil {
		t.Fatalf("backdate: %v", err)
	}

	// Cutoff is 1 hour ago: the old row qualifies, the young row
	// (ref_count=1) is filtered out by the predicate.
	cutoff := time.Now().Add(-time.Hour)
	got, err := r.ListGCCandidates(ctx, cutoff, 100)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].Key != "cas/old/zero" {
		t.Fatalf("expected only old/zero; got %+v", got)
	}
}
