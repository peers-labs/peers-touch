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

// ---------------------------------------------------------------------------
// FileRepository — MarkDeleted / Restore (S4)
// ---------------------------------------------------------------------------

// seedLiveFile inserts a minimal live FileMeta row so tests can
// poke at the soft-delete state machine without dragging the full
// upload writer in.
func seedLiveFile(t *testing.T, db *gorm.DB, id, owner, key string) *ossmodel.FileMeta {
	t.Helper()
	row := &ossmodel.FileMeta{
		ID:            id,
		Key:           key,
		Name:          "n",
		Size:          10,
		Backend:       "local",
		Sha256:        "h",
		OwnerActorID:  owner,
		BucketID:      "bk-" + id,
		Visibility:    ossmodel.VisibilityPrivate,
		ChatSessionID: "",
	}
	if err := db.Create(row).Error; err != nil {
		t.Fatalf("seed file: %v", err)
	}
	return row
}

func TestFileRepo_MarkDeleted_FlipsLiveRow(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	row := seedLiveFile(t, db, "f1", "did:test:alice", "cas/aa/abc")

	now := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	if err := r.MarkDeleted(ctx, row.ID, now); err != nil {
		t.Fatalf("MarkDeleted: %v", err)
	}

	// Live find misses; include-deleted hits with DeletedAt set.
	if _, err := r.FindByOwnerKey(ctx, "did:test:alice", "cas/aa/abc"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("live find should miss, got err=%v", err)
	}
	got, err := r.FindByOwnerKeyIncludeDeleted(ctx, "did:test:alice", "cas/aa/abc")
	if err != nil {
		t.Fatalf("include-deleted find: %v", err)
	}
	if got.DeletedAt == nil || !got.DeletedAt.Equal(now) {
		t.Fatalf("DeletedAt not stamped: %+v", got.DeletedAt)
	}
	if !got.UpdatedAt.Equal(now) {
		t.Fatalf("UpdatedAt not refreshed: %v", got.UpdatedAt)
	}
}

func TestFileRepo_MarkDeleted_AlreadyDeletedIsIdempotent(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	row := seedLiveFile(t, db, "f2", "did:test:alice", "cas/aa/dup")

	first := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	if err := r.MarkDeleted(ctx, row.ID, first); err != nil {
		t.Fatalf("first delete: %v", err)
	}

	// Second call must report ErrFileAlreadyDeleted *without*
	// touching DeletedAt — the caller relies on this to skip
	// re-debiting bucket/blob state.
	second := first.Add(5 * time.Minute)
	err := r.MarkDeleted(ctx, row.ID, second)
	if !errors.Is(err, ErrFileAlreadyDeleted) {
		t.Fatalf("expected ErrFileAlreadyDeleted, got %v", err)
	}

	got, err := r.FindByOwnerKeyIncludeDeleted(ctx, "did:test:alice", "cas/aa/dup")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.DeletedAt == nil || !got.DeletedAt.Equal(first) {
		t.Fatalf("DeletedAt must remain the original timestamp, got %v", got.DeletedAt)
	}
}

func TestFileRepo_MarkDeleted_UnknownIDReturnsErrFileNotFound(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	err := r.MarkDeleted(context.Background(), "ghost", time.Now())
	if !errors.Is(err, ErrFileNotFound) {
		t.Fatalf("expected ErrFileNotFound, got %v", err)
	}
}

func TestFileRepo_Restore_ClearsDeletedAt(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	row := seedLiveFile(t, db, "f3", "did:test:alice", "cas/aa/restorable")

	now := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	if err := r.MarkDeleted(ctx, row.ID, now); err != nil {
		t.Fatalf("delete: %v", err)
	}

	restoredAt := now.Add(time.Hour)
	expiry := restoredAt.Add(7 * 24 * time.Hour)
	if err := r.Restore(ctx, row.ID, restoredAt, &expiry); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	got, err := r.FindByOwnerKey(ctx, "did:test:alice", "cas/aa/restorable")
	if err != nil {
		t.Fatalf("post-restore live find: %v", err)
	}
	if got.DeletedAt != nil {
		t.Fatalf("DeletedAt must be cleared, got %v", got.DeletedAt)
	}
	if got.ExpiresAt == nil || !got.ExpiresAt.Equal(expiry) {
		t.Fatalf("ExpiresAt not refreshed, got %v", got.ExpiresAt)
	}
	if !got.UpdatedAt.Equal(restoredAt) {
		t.Fatalf("UpdatedAt not refreshed, got %v", got.UpdatedAt)
	}
}

func TestFileRepo_Restore_UnknownIDReturnsErrFileNotFound(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	err := r.Restore(context.Background(), "ghost", time.Now(), nil)
	if !errors.Is(err, ErrFileNotFound) {
		t.Fatalf("expected ErrFileNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// FileRepository — Patch (S5)
// ---------------------------------------------------------------------------

func TestFileRepo_Patch_AppliesNonNilFields(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	row := seedLiveFile(t, db, "f-patch", "did:test:alice", "cas/aa/patchable")

	now := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	exp := now.Add(48 * time.Hour)
	vis := ossmodel.VisibilityPrivate
	bid := "bk-new"
	fname := "renamed.txt"
	if err := r.Patch(ctx, row.ID, FilePatch{
		Visibility:   &vis,
		BucketID:     &bid,
		Filename:     &fname,
		ExpiresAtSet: true,
		ExpiresAt:    &exp,
	}, now); err != nil {
		t.Fatalf("Patch: %v", err)
	}

	got, err := r.FindByOwnerKey(ctx, "did:test:alice", "cas/aa/patchable")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Visibility != vis {
		t.Errorf("visibility = %q, want %q", got.Visibility, vis)
	}
	if got.BucketID != bid {
		t.Errorf("bucket_id = %q, want %q", got.BucketID, bid)
	}
	if got.Name != fname {
		t.Errorf("name = %q, want %q", got.Name, fname)
	}
	if got.ExpiresAt == nil || !got.ExpiresAt.Equal(exp) {
		t.Errorf("expires_at = %v, want %v", got.ExpiresAt, exp)
	}
	if !got.UpdatedAt.Equal(now) {
		t.Errorf("updated_at = %v, want %v", got.UpdatedAt, now)
	}
}

func TestFileRepo_Patch_ClearsExpiresAtWhenSetButNil(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	row := seedLiveFile(t, db, "f-clear", "did:test:alice", "cas/aa/clear")

	// Seed an expiry then clear it via patch.
	exp := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	if err := r.Patch(ctx, row.ID, FilePatch{
		ExpiresAtSet: true,
		ExpiresAt:    &exp,
	}, time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("seed expiry: %v", err)
	}
	if err := r.Patch(ctx, row.ID, FilePatch{
		ExpiresAtSet: true,
		ExpiresAt:    nil,
	}, time.Date(2026, 4, 27, 1, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("clear expiry: %v", err)
	}

	got, err := r.FindByOwnerKey(ctx, "did:test:alice", "cas/aa/clear")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.ExpiresAt != nil {
		t.Errorf("expires_at must be NULL after clear-patch, got %v", got.ExpiresAt)
	}
}

func TestFileRepo_Patch_RejectsEmptyPatch(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	row := seedLiveFile(t, db, "f-empty", "did:test:alice", "cas/aa/empty")

	err := r.Patch(context.Background(), row.ID, FilePatch{}, time.Now())
	if err == nil || err.Error() != "oss: file patch: empty patch" {
		t.Fatalf("expected empty-patch error, got %v", err)
	}
}

func TestFileRepo_Patch_DeletedRowReturnsErrFileNotFound(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	row := seedLiveFile(t, db, "f-pd", "did:test:alice", "cas/aa/pd")
	if err := r.MarkDeleted(ctx, row.ID, time.Now()); err != nil {
		t.Fatalf("delete seed: %v", err)
	}

	fname := "renamed.txt"
	err := r.Patch(ctx, row.ID, FilePatch{Filename: &fname}, time.Now())
	if !errors.Is(err, ErrFileNotFound) {
		t.Fatalf("expected ErrFileNotFound (soft-deleted row), got %v", err)
	}
}

// ---------------------------------------------------------------------------
// MetaRepository (S5)
// ---------------------------------------------------------------------------

func TestMetaRepo_GetReturnsEmptyForMissingRow(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewMetaRepository("default")
	got, err := r.Get(context.Background(), ossmodel.MetaKeyCapabilityVersion)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != "" {
		t.Fatalf("expected empty string for missing row, got %q", got)
	}
	_ = db
}

// ---------------------------------------------------------------------------
// FileRepository — ListByOwner (S6)
// ---------------------------------------------------------------------------

// seedFileRow inserts a fully-formed file row with the supplied
// fields for ListByOwner test scenarios. It bypasses the production
// helpers because we want to control CreatedAt explicitly.
func seedFileRow(t *testing.T, db *gorm.DB, id, owner, key, bucketID, vis, mime string, size int64, created time.Time, deletedAt *time.Time) *ossmodel.FileMeta {
	t.Helper()
	row := &ossmodel.FileMeta{
		ID:           id,
		Key:          key,
		Name:         id,
		Size:         size,
		Mime:         mime,
		Backend:      "test",
		Path:         "/tmp/" + key,
		Sha256:       "",
		BucketID:     bucketID,
		OwnerActorID: owner,
		Visibility:   vis,
		CreatedAt:    created,
		UpdatedAt:    created,
		DeletedAt:    deletedAt,
	}
	if err := db.Create(row).Error; err != nil {
		t.Fatalf("seed file row %q: %v", id, err)
	}
	return row
}

func TestFileRepo_ListByOwner_FiltersAndPaginates(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()

	owner := "did:test:alice"
	other := "did:test:bob"
	bChat := "bk-chat"
	bPersonal := "bk-personal"

	t0 := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	// Three rows for alice, one for bob, one soft-deleted for alice.
	seedFileRow(t, db, "f1", owner, "k1", bChat, ossmodel.VisibilityChat, "image/png", 100, t0, nil)
	seedFileRow(t, db, "f2", owner, "k2", bChat, ossmodel.VisibilityPrivate, "image/jpeg", 200, t0.Add(time.Minute), nil)
	seedFileRow(t, db, "f3", owner, "k3", bPersonal, ossmodel.VisibilityPublic, "application/pdf", 300, t0.Add(2*time.Minute), nil)
	seedFileRow(t, db, "fbob", other, "k1", bChat, ossmodel.VisibilityChat, "image/png", 99, t0, nil)
	deletedAt := t0.Add(time.Hour)
	seedFileRow(t, db, "fdel", owner, "k4", bChat, ossmodel.VisibilityChat, "image/png", 50, t0.Add(3*time.Minute), &deletedAt)

	// Default: live rows only, scoped to owner.
	rows, total, err := r.ListByOwner(ctx, owner, ListByOwnerFilter{}, 50, 0)
	if err != nil {
		t.Fatalf("ListByOwner default: %v", err)
	}
	if total != 3 {
		t.Errorf("default total = %d, want 3", total)
	}
	if got := len(rows); got != 3 {
		t.Errorf("default len(rows) = %d, want 3", got)
	}
	// Order: created_at DESC ⇒ f3, f2, f1.
	if rows[0].ID != "f3" || rows[1].ID != "f2" || rows[2].ID != "f1" {
		t.Errorf("default order = [%s,%s,%s], want [f3,f2,f1]", rows[0].ID, rows[1].ID, rows[2].ID)
	}

	// IncludeDeleted: now sees f4 too.
	rows, total, err = r.ListByOwner(ctx, owner, ListByOwnerFilter{IncludeDeleted: true}, 50, 0)
	if err != nil {
		t.Fatalf("ListByOwner include-deleted: %v", err)
	}
	if total != 4 {
		t.Errorf("include-deleted total = %d, want 4", total)
	}
	if rows[0].ID != "fdel" {
		t.Errorf("include-deleted order[0] = %s, want fdel", rows[0].ID)
	}

	// Bucket filter.
	rows, total, _ = r.ListByOwner(ctx, owner, ListByOwnerFilter{BucketID: bPersonal}, 50, 0)
	if total != 1 || len(rows) != 1 || rows[0].ID != "f3" {
		t.Errorf("bucket filter rows=%v total=%d, want [f3] total=1", rows, total)
	}

	// Visibility filter.
	rows, total, _ = r.ListByOwner(ctx, owner, ListByOwnerFilter{Visibility: ossmodel.VisibilityChat}, 50, 0)
	if total != 1 || len(rows) != 1 || rows[0].ID != "f1" {
		t.Errorf("visibility filter rows=%v total=%d, want [f1] total=1", rows, total)
	}

	// MIME prefix filter.
	rows, total, _ = r.ListByOwner(ctx, owner, ListByOwnerFilter{MimePrefix: "image/"}, 50, 0)
	if total != 2 {
		t.Errorf("mime prefix total = %d, want 2", total)
	}
	if len(rows) != 2 || rows[0].ID != "f2" || rows[1].ID != "f1" {
		t.Errorf("mime prefix rows = %v, want [f2 f1]", rows)
	}

	// Pagination: page_size=1.
	rows, total, _ = r.ListByOwner(ctx, owner, ListByOwnerFilter{}, 1, 0)
	if total != 3 || len(rows) != 1 || rows[0].ID != "f3" {
		t.Errorf("page1 rows=%v total=%d, want [f3] total=3", rows, total)
	}
	rows, _, _ = r.ListByOwner(ctx, owner, ListByOwnerFilter{}, 1, 1)
	if len(rows) != 1 || rows[0].ID != "f2" {
		t.Errorf("page2 rows=%v, want [f2]", rows)
	}
	rows, _, _ = r.ListByOwner(ctx, owner, ListByOwnerFilter{}, 1, 5)
	if len(rows) != 0 {
		t.Errorf("page beyond total rows=%v, want empty", rows)
	}
}

func TestFileRepo_ListByOwner_RejectsEmptyOwner(t *testing.T) {
	db := initStore(t)
	reset(t, db)
	_ = db
	r := NewFileRepository("default")
	if _, _, err := r.ListByOwner(context.Background(), "", ListByOwnerFilter{}, 10, 0); err == nil {
		t.Fatal("expected error for empty owner, got nil")
	}
}

func TestFileRepo_ListByOwner_LikeMetaCharsEscaped(t *testing.T) {
	db := initStore(t)
	reset(t, db)
	r := NewFileRepository("default")
	ctx := context.Background()

	owner := "did:test:alice"
	t0 := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	seedFileRow(t, db, "fa", owner, "ka", "bk", ossmodel.VisibilityPrivate, "application/x_pdf", 1, t0, nil)
	seedFileRow(t, db, "fb", owner, "kb", "bk", ossmodel.VisibilityPrivate, "application/xpdf", 1, t0.Add(time.Minute), nil)

	// Without escaping, `application/x_` would match both rows
	// because `_` is a single-character wildcard. Confirm only
	// `application/x_pdf` is returned.
	rows, total, err := r.ListByOwner(ctx, owner, ListByOwnerFilter{MimePrefix: "application/x_"}, 50, 0)
	if err != nil {
		t.Fatalf("ListByOwner: %v", err)
	}
	if total != 1 || len(rows) != 1 || rows[0].ID != "fa" {
		t.Errorf("escaped prefix rows=%v total=%d, want [fa] total=1", rows, total)
	}
}

func TestMetaRepo_SetCapabilityVersionInsertsThenUpdates(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewMetaRepository("default")
	ctx := context.Background()

	// First call: insert.
	v1, err := r.SetCapabilityVersion(ctx, time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("first set: %v", err)
	}
	if v1 == "" {
		t.Fatal("first set returned empty value")
	}

	got, err := r.Get(ctx, ossmodel.MetaKeyCapabilityVersion)
	if err != nil || got != v1 {
		t.Fatalf("Get post-insert = %q, %v; want %q", got, err, v1)
	}

	// Second call (later wallclock): update with a new ULID.
	v2, err := r.SetCapabilityVersion(ctx, time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("second set: %v", err)
	}
	if v1 == v2 {
		t.Fatalf("second set should mint a fresh value, got identical %q", v1)
	}

	got2, _ := r.Get(ctx, ossmodel.MetaKeyCapabilityVersion)
	if got2 != v2 {
		t.Fatalf("Get post-update = %q, want %q", got2, v2)
	}

	// Sanity: there should still be a single row for this key.
	var n int64
	if err := db.Model(&ossmodel.Meta{}).
		Where("key = ?", ossmodel.MetaKeyCapabilityVersion).
		Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected exactly 1 capability_version row, got %d", n)
	}
}

// ---------------------------------------------------------------------------
// S12 additions: SumByBucket / SetUsage / DeleteUnpinnedOlderThan / Meta Set+Delete
// ---------------------------------------------------------------------------

func TestFileRepo_SumByBucketIgnoresDeletedRows(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewFileRepository("default")
	ctx := context.Background()
	now := time.Now()
	deletedAt := now.Add(-time.Minute)

	rows := []ossmodel.FileMeta{
		{ID: "f1", Key: "k1", BucketID: "bk_a", Size: 10, CreatedAt: now},
		{ID: "f2", Key: "k2", BucketID: "bk_a", Size: 25, CreatedAt: now},
		{ID: "f3", Key: "k3", BucketID: "bk_a", Size: 999, CreatedAt: now, DeletedAt: &deletedAt},
		{ID: "f4", Key: "k4", BucketID: "bk_b", Size: 7, CreatedAt: now},
	}
	for i := range rows {
		if err := r.Create(ctx, &rows[i]); err != nil {
			t.Fatalf("seed %s: %v", rows[i].ID, err)
		}
	}

	bytes, count, err := r.SumByBucket(ctx, "bk_a")
	if err != nil {
		t.Fatalf("SumByBucket: %v", err)
	}
	if bytes != 35 || count != 2 {
		t.Errorf("bk_a sum: got (%d,%d), want (35,2)", bytes, count)
	}

	// Empty bucket.
	bytes, count, err = r.SumByBucket(ctx, "bk_unknown")
	if err != nil {
		t.Fatalf("SumByBucket unknown: %v", err)
	}
	if bytes != 0 || count != 0 {
		t.Errorf("unknown bucket should yield zeros, got (%d,%d)", bytes, count)
	}

	// Empty id is rejected.
	if _, _, err := r.SumByBucket(ctx, ""); err == nil {
		t.Error("empty bucketID should error")
	}
}

func TestBucketRepo_SetUsageRewritesAbsoluteCounters(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewBucketRepository("default")
	ctx := context.Background()

	b := &ossmodel.Bucket{
		ID: "bk_setusage", Name: "u", OwnerActorID: "did:test:alice",
		Kind: ossmodel.BucketKindUser, DefaultVisibility: "private",
		UsedBytes: 100, ObjectCount: 5,
	}
	if err := r.Create(ctx, b); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := r.SetUsage(ctx, b.ID, 9_999, 42); err != nil {
		t.Fatalf("SetUsage: %v", err)
	}
	got, err := r.FindByID(ctx, b.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.UsedBytes != 9_999 || got.ObjectCount != 42 {
		t.Errorf("SetUsage write: got (%d,%d), want (9999,42)", got.UsedBytes, got.ObjectCount)
	}

	// Negative inputs clamp to zero rather than corrupting the row.
	if err := r.SetUsage(ctx, b.ID, -1, -1); err != nil {
		t.Fatalf("SetUsage negative: %v", err)
	}
	got, _ = r.FindByID(ctx, b.ID)
	if got.UsedBytes != 0 || got.ObjectCount != 0 {
		t.Errorf("negative SetUsage should clamp to zero, got (%d,%d)", got.UsedBytes, got.ObjectCount)
	}

	// Unknown id surfaces ErrBucketNotFound.
	if err := r.SetUsage(ctx, "missing", 1, 1); !errors.Is(err, ErrBucketNotFound) {
		t.Errorf("unknown id: got %v, want ErrBucketNotFound", err)
	}
	_ = db
}

func TestPeerKeyRepo_DeleteUnpinnedOlderThanSpresPinned(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewPeerKeyRepository("default")
	ctx := context.Background()
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	old := now.Add(-60 * 24 * time.Hour)
	fresh := now.Add(-time.Hour)
	pinAt := now

	rows := []ossmodel.PeerKey{
		{PeerStationID: "p1", KID: "k1", PublicKeyPEM: "x", FirstSeenAt: old, LastSeenAt: old},
		{PeerStationID: "p2", KID: "k2", PublicKeyPEM: "x", FirstSeenAt: fresh, LastSeenAt: fresh},
		{PeerStationID: "p3", KID: "k3", PublicKeyPEM: "x", FirstSeenAt: old, LastSeenAt: old, Pinned: true, PinnedAt: &pinAt},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("seed %s: %v", rows[i].PeerStationID, err)
		}
	}

	cutoff := now.Add(-30 * 24 * time.Hour)
	deleted, err := r.DeleteUnpinnedOlderThan(ctx, cutoff)
	if err != nil {
		t.Fatalf("DeleteUnpinnedOlderThan: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted: got %d, want 1 (only p1 should be trimmed)", deleted)
	}

	// p1 gone, p2 + p3 still present.
	for _, want := range []string{"p2", "p3"} {
		row, err := r.GetPeer(ctx, want)
		if err != nil {
			t.Fatalf("GetPeer %s: %v", want, err)
		}
		if row == nil {
			t.Errorf("expected %s to survive trim", want)
		}
	}
	if row, _ := r.GetPeer(ctx, "p1"); row != nil {
		t.Errorf("p1 should have been trimmed")
	}

	// Zero cutoff is a quiet no-op.
	if n, err := r.DeleteUnpinnedOlderThan(ctx, time.Time{}); err != nil || n != 0 {
		t.Errorf("zero cutoff: got (%d,%v), want (0,nil)", n, err)
	}
}

func TestMetaRepo_SetAndDelete(t *testing.T) {
	db := initStore(t)
	reset(t, db)

	r := NewMetaRepository("default")
	ctx := context.Background()
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)

	// Insert via Set.
	if err := r.Set(ctx, "test_key_a", "value-1", now); err != nil {
		t.Fatalf("Set insert: %v", err)
	}
	got, err := r.Get(ctx, "test_key_a")
	if err != nil || got != "value-1" {
		t.Fatalf("Get after insert: got (%q,%v)", got, err)
	}

	// Update via Set.
	if err := r.Set(ctx, "test_key_a", "value-2", now.Add(time.Hour)); err != nil {
		t.Fatalf("Set update: %v", err)
	}
	got, _ = r.Get(ctx, "test_key_a")
	if got != "value-2" {
		t.Errorf("post-update: got %q, want value-2", got)
	}

	// Delete handles a mix of present and absent keys.
	if err := r.Set(ctx, "test_key_b", "value-b", now); err != nil {
		t.Fatalf("Set b: %v", err)
	}
	deleted, err := r.Delete(ctx, "test_key_a", "test_key_b", "missing_key")
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if deleted != 2 {
		t.Errorf("Delete count: got %d, want 2", deleted)
	}
	if got, _ := r.Get(ctx, "test_key_a"); got != "" {
		t.Errorf("test_key_a should be cleared, got %q", got)
	}

	// Delete with no keys is a quiet no-op.
	if n, err := r.Delete(ctx); err != nil || n != 0 {
		t.Errorf("empty Delete: got (%d,%v)", n, err)
	}

	// Empty key on Set is rejected.
	if err := r.Set(ctx, "", "x", now); err == nil {
		t.Error("empty key should error")
	}

	_ = db
}
