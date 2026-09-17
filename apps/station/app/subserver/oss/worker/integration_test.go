// Integration test suite for the OSS workers. Each test wires the
// real repo implementations against an in-memory sqlite handle (no
// fakes) so we exercise the same SQL paths production hits. The
// fakes-only tests in `*_test.go` cover unit-level behaviour and
// edge cases; this file is the contract that "the worker actually
// changes state in the database" stays true after refactors.
//
// Why both layers? A mock-only suite is fast and cheap to extend
// but cannot catch column-name typos, missing indexes, or
// dialect-specific quirks. A live-DB suite catches those but is
// slow when over-used. Splitting the responsibility lets us keep
// CI fast while still proving the contract end-to-end.
package worker

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Per-binary store fixture
// ---------------------------------------------------------------------------

// integrationDBName matches the value the repo constructors pass
// to `store.WithRDSDBName`. Any string works — the mock store
// returns the shared handle regardless — but using a stable name
// keeps log output readable when a test fails.
const integrationDBName = "oss-worker-integration"

type workerIntegrationStore struct{ db *gorm.DB }

func (s *workerIntegrationStore) Init(_ context.Context, _ ...option.Option) error { return nil }
func (s *workerIntegrationStore) RDS(_ context.Context, _ ...store.RDSDMLOption) (*gorm.DB, error) {
	return s.db, nil
}
func (s *workerIntegrationStore) Name() string { return "oss-worker-integration-store" }

var (
	integrationOnce sync.Once
	integrationDB   *gorm.DB
	integrationErr  error
)

// initIntegrationStore wires sqlite ":memory:" once per test binary
// and migrates every OSS schema model the workers touch. Subsequent
// callers reuse the handle. Callers reset the tables they touch at
// the top of each test so the suite stays order-independent.
func initIntegrationStore(t *testing.T) *gorm.DB {
	t.Helper()
	integrationOnce.Do(func() {
		// `cache=shared` lets concurrent goroutines see the same
		// data — important because gorm sessions internally pool
		// connections.
		integrationDB, integrationErr = gorm.Open(
			sqlite.Open("file:workerinteg?mode=memory&cache=shared"),
			&gorm.Config{},
		)
		if integrationErr != nil {
			return
		}
		integrationErr = integrationDB.AutoMigrate(
			&ossmodel.FileMeta{},
			&ossmodel.Bucket{},
			&ossmodel.Audit{},
			&ossmodel.Meta{},
			&ossmodel.Blob{},
		)
		if integrationErr != nil {
			return
		}
		integrationErr = federation.MigrateSchema(context.Background(), integrationDB)
		if integrationErr != nil {
			return
		}
		_ = store.InjectStore(context.Background(), &workerIntegrationStore{db: integrationDB})
	})
	if integrationErr != nil {
		t.Fatalf("init integration store: %v", integrationErr)
	}
	return integrationDB
}

// resetIntegration truncates every table the worker tests touch.
// Tests must call this at the top so a row leaked from another
// test does not skew the assertions.
func resetIntegration(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, tbl := range []string{
		"oss_files", "oss_buckets", "oss_audit",
		"oss_meta", "oss_blobs",
		federation.PeerKeyTable,
		federation.AuthLocalKeyTable,
		federation.ContentProofVerificationKeyTable,
	} {
		if err := db.Exec("DELETE FROM " + tbl).Error; err != nil {
			t.Fatalf("reset %s: %v", tbl, err)
		}
	}
}

// ---------------------------------------------------------------------------
// Backend fake — captures Delete calls so BlobGC can be asserted
// without hitting a real filesystem.
// ---------------------------------------------------------------------------

type integrationBackend struct {
	mu      sync.Mutex
	deleted []string
	delErr  error
}

func (b *integrationBackend) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (b *integrationBackend) Open(context.Context, string, *storage.Range) (io.ReadCloser, int64, string, error) {
	return nil, 0, "", errors.New("not implemented")
}
func (b *integrationBackend) Stat(context.Context, string) (*storage.StatInfo, error) {
	return nil, nil
}
func (b *integrationBackend) Healthz(context.Context) error { return nil }
func (b *integrationBackend) Delete(_ context.Context, key string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.delErr != nil {
		return b.delErr
	}
	b.deleted = append(b.deleted, key)
	return nil
}

// ---------------------------------------------------------------------------
// TTLSweeper — soft-deletes expired files, debits bucket usage,
// decrements blob refcount, and audits each delete.
// ---------------------------------------------------------------------------

func TestTTLSweeper_Integration_SoftDeletesExpiredAndDebits(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	pastExpiry := now.Add(-time.Hour)

	bucket := ossmodel.Bucket{
		ID: "b-1", Name: "chat", OwnerPTID: "actor-a",
		Kind: "system", SystemKey: "chat", DefaultVisibility: "chat",
		QuotaBytes: 100, UsedBytes: 80, ObjectCount: 2,
		CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("seed bucket: %v", err)
	}

	expired := ossmodel.FileMeta{
		ID: "f-expired", Key: "cas/aa/expired", Name: "n", BucketID: "b-1",
		OwnerPTID: "actor-a", Visibility: "chat", Backend: "local",
		Size: 30, ExpiresAt: &pastExpiry, CreatedAt: now.Add(-time.Hour),
	}
	live := ossmodel.FileMeta{
		ID: "f-live", Key: "cas/bb/live", Name: "n", BucketID: "b-1",
		OwnerPTID: "actor-a", Visibility: "chat", Backend: "local",
		Size: 50, CreatedAt: now.Add(-time.Hour),
	}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatalf("seed expired file: %v", err)
	}
	if err := db.Create(&live).Error; err != nil {
		t.Fatalf("seed live file: %v", err)
	}
	if err := db.Create(&ossmodel.Blob{
		Backend: "local", Key: expired.Key, Size: expired.Size,
		RefCount: 1, LastSeenAt: now.Add(-time.Hour),
	}).Error; err != nil {
		t.Fatalf("seed blob: %v", err)
	}

	files := repo.NewFileRepository(integrationDBName)
	buckets := repo.NewBucketRepository(integrationDBName)
	blobs := repo.NewBlobRepository(integrationDBName)
	audit := repo.NewAuditRepository(integrationDBName)

	sweeper, err := NewTTLSweeper(TTLSweeperConfig{
		Files:       files,
		Buckets:     buckets,
		Blobs:       blobs,
		Audit:       audit,
		BackendName: "local",
		Now:         func() time.Time { return now },
		Interval:    time.Hour,
	})
	if err != nil {
		t.Fatalf("NewTTLSweeper: %v", err)
	}
	if err := sweeper.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// Expired row should now be soft-deleted.
	var afterExpired ossmodel.FileMeta
	if err := db.Where("id = ?", expired.ID).Take(&afterExpired).Error; err != nil {
		t.Fatalf("read expired post-sweep: %v", err)
	}
	if afterExpired.DeletedAt == nil {
		t.Errorf("expired file should be soft-deleted post-sweep")
	}

	// Live row untouched.
	var afterLive ossmodel.FileMeta
	if err := db.Where("id = ?", live.ID).Take(&afterLive).Error; err != nil {
		t.Fatalf("read live post-sweep: %v", err)
	}
	if afterLive.DeletedAt != nil {
		t.Errorf("live file should NOT be soft-deleted: %+v", afterLive)
	}

	// Bucket usage should drop by exactly the expired file's size and count.
	var afterBucket ossmodel.Bucket
	if err := db.Where("id = ?", bucket.ID).Take(&afterBucket).Error; err != nil {
		t.Fatalf("read bucket post-sweep: %v", err)
	}
	if afterBucket.UsedBytes != bucket.UsedBytes-expired.Size {
		t.Errorf("bucket UsedBytes: got %d want %d (debited by expired.Size)",
			afterBucket.UsedBytes, bucket.UsedBytes-expired.Size)
	}
	if afterBucket.ObjectCount != bucket.ObjectCount-1 {
		t.Errorf("bucket ObjectCount: got %d want %d", afterBucket.ObjectCount, bucket.ObjectCount-1)
	}

	// Blob refcount goes to 0 (orphan, ready for BlobGC pickup).
	var afterBlob ossmodel.Blob
	if err := db.Where("`key` = ?", expired.Key).Take(&afterBlob).Error; err != nil {
		t.Fatalf("read blob post-sweep: %v", err)
	}
	if afterBlob.RefCount != 0 {
		t.Errorf("blob refcount: got %d want 0 after sweep", afterBlob.RefCount)
	}

	// Audit row landed: action=delete, reason=ttl, file_id matches.
	var auditRows []ossmodel.Audit
	if err := db.Where("action = ?", ossmodel.AuditActionDelete).Find(&auditRows).Error; err != nil {
		t.Fatalf("read audit: %v", err)
	}
	matched := 0
	for _, r := range auditRows {
		if r.FileID == expired.ID && r.Reason == "ttl" {
			matched++
		}
	}
	if matched != 1 {
		t.Errorf("expected 1 ttl-delete audit for expired file, got %d (rows=%+v)", matched, auditRows)
	}
}

// ---------------------------------------------------------------------------
// BlobGC — physically removes blobs with refcount=0 + age beyond
// the grace window, audits the deletion, and leaves referenced
// blobs alone.
// ---------------------------------------------------------------------------

func TestBlobGC_Integration_RemovesOrphansAndPreservesReferenced(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	graceCutoff := now.Add(-2 * time.Hour)
	withinGrace := now.Add(-30 * time.Minute)

	if err := db.Create([]ossmodel.Blob{
		// Eligible: refcount=0 AND last_seen_at older than grace.
		{Backend: "local", Key: "cas/aa/orphan-old", Size: 10, RefCount: 0, LastSeenAt: graceCutoff.Add(-time.Hour)},
		// Within grace — refcount=0 but too recent; must be kept.
		{Backend: "local", Key: "cas/aa/orphan-fresh", Size: 10, RefCount: 0, LastSeenAt: withinGrace},
		// Referenced — refcount>0; must always be kept regardless of age.
		{Backend: "local", Key: "cas/aa/live", Size: 10, RefCount: 3, LastSeenAt: graceCutoff.Add(-time.Hour)},
	}).Error; err != nil {
		t.Fatalf("seed blobs: %v", err)
	}

	blobs := repo.NewBlobRepository(integrationDBName)
	audit := repo.NewAuditRepository(integrationDBName)
	backend := &integrationBackend{}

	gc, err := NewBlobGC(BlobGCConfig{
		Blobs:       blobs,
		Backend:     backend,
		Audit:       audit,
		BackendName: "local",
		Now:         func() time.Time { return now },
		Grace:       time.Hour,
		Interval:    time.Hour,
	})
	if err != nil {
		t.Fatalf("NewBlobGC: %v", err)
	}
	if err := gc.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// orphan-old must be gone from the table AND the backend must
	// have seen the Delete call exactly once for that key.
	var rows []ossmodel.Blob
	if err := db.Find(&rows).Error; err != nil {
		t.Fatalf("read blobs: %v", err)
	}
	keys := map[string]bool{}
	for _, r := range rows {
		keys[r.Key] = true
	}
	if keys["cas/aa/orphan-old"] {
		t.Errorf("expired orphan should be removed from blobs table")
	}
	if !keys["cas/aa/orphan-fresh"] {
		t.Errorf("within-grace orphan must be preserved")
	}
	if !keys["cas/aa/live"] {
		t.Errorf("referenced blob must be preserved")
	}
	if len(backend.deleted) != 1 || backend.deleted[0] != "cas/aa/orphan-old" {
		t.Errorf("backend.Delete calls: got %v want [cas/aa/orphan-old]", backend.deleted)
	}

	// Audit row landed for the GC.
	var auditRows []ossmodel.Audit
	if err := db.Where("action = ?", ossmodel.AuditActionBlobGC).Find(&auditRows).Error; err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if len(auditRows) != 1 {
		t.Errorf("expected 1 blob_gc audit row, got %d", len(auditRows))
	}
}

// ---------------------------------------------------------------------------
// BucketReconciler — corrects drift between the cached
// (UsedBytes, ObjectCount) counters and the SUM(oss_files.size)
// truth. Soft-deleted rows must NOT be counted.
// ---------------------------------------------------------------------------

func TestBucketReconciler_Integration_CorrectsCountAndByteDrift(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)

	// Bucket claims 999 bytes / 99 objects but the actual file
	// rows below sum to 30 bytes / 1 row (one is soft-deleted).
	bucket := ossmodel.Bucket{
		ID: "b-drift", Name: "drifted", OwnerPTID: "actor-a", Kind: "user",
		DefaultVisibility: "private", QuotaBytes: 1 << 30,
		UsedBytes: 999, ObjectCount: 99,
		CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("seed bucket: %v", err)
	}

	deletedTS := now.Add(-time.Minute)
	files := []ossmodel.FileMeta{
		{ID: "f-1", Key: "k1", Name: "n", BucketID: "b-drift", OwnerPTID: "actor-a",
			Visibility: "private", Backend: "local", Size: 30, CreatedAt: now.Add(-time.Hour)},
		{ID: "f-2", Key: "k2", Name: "n", BucketID: "b-drift", OwnerPTID: "actor-a",
			Visibility: "private", Backend: "local", Size: 1000,
			DeletedAt: &deletedTS, CreatedAt: now.Add(-time.Hour)},
	}
	for i := range files {
		if err := db.Create(&files[i]).Error; err != nil {
			t.Fatalf("seed file %s: %v", files[i].ID, err)
		}
	}

	rec, err := NewBucketReconciler(BucketReconcilerConfig{
		Files:         repo.NewFileRepository(integrationDBName),
		Buckets:       repo.NewBucketRepository(integrationDBName),
		Audit:         repo.NewAuditRepository(integrationDBName),
		Now:           func() time.Time { return now },
		Interval:      time.Hour,
		DriftPermille: 0, // any drift counts
	})
	if err != nil {
		t.Fatalf("NewBucketReconciler: %v", err)
	}
	if err := rec.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	var after ossmodel.Bucket
	if err := db.Where("id = ?", bucket.ID).Take(&after).Error; err != nil {
		t.Fatalf("read bucket post-reconcile: %v", err)
	}
	if after.UsedBytes != 30 {
		t.Errorf("UsedBytes: got %d want 30 (live files only)", after.UsedBytes)
	}
	if after.ObjectCount != 1 {
		t.Errorf("ObjectCount: got %d want 1 (soft-deleted excluded)", after.ObjectCount)
	}

	// Audit row landed naming the bucket.
	var auditRows []ossmodel.Audit
	if err := db.Where("bucket_id = ?", bucket.ID).Find(&auditRows).Error; err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if len(auditRows) == 0 {
		t.Errorf("expected at least one audit row from reconciler")
	}
}

// ---------------------------------------------------------------------------
// PeerKeyTrim — drops unpinned + idle peers, preserves pinned and
// recently-seen peers.
// ---------------------------------------------------------------------------

func TestPeerKeyTrim_Integration_DropsUnpinnedIdleOnly(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	idle := now.Add(-30 * 24 * time.Hour)
	recent := now.Add(-time.Hour)

	if err := db.Create([]federation.PeerKeyRow{
		{StationID: "old-unpinned", Kid: "k1", PubPEM: "PEM",
			FirstSeenAt: idle, LastSeenAt: idle, Pinned: false},
		{StationID: "old-pinned", Kid: "k2", PubPEM: "PEM",
			FirstSeenAt: idle, LastSeenAt: idle, Pinned: true},
		{StationID: "fresh-unpinned", Kid: "k3", PubPEM: "PEM",
			FirstSeenAt: recent, LastSeenAt: recent, Pinned: false},
	}).Error; err != nil {
		t.Fatalf("seed peers: %v", err)
	}

	trim, err := NewPeerKeyTrim(PeerKeyTrimConfig{
		Peers:    federation.NewPeerKeyStoreGORM(integrationDBName),
		Audit:    repo.NewAuditRepository(integrationDBName),
		MaxIdle:  7 * 24 * time.Hour,
		Interval: 24 * time.Hour,
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewPeerKeyTrim: %v", err)
	}
	if err := trim.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	var rows []federation.PeerKeyRow
	if err := db.Find(&rows).Error; err != nil {
		t.Fatalf("read peers: %v", err)
	}
	left := map[string]bool{}
	for _, r := range rows {
		left[r.StationID] = true
	}
	if left["old-unpinned"] {
		t.Errorf("idle unpinned peer should be trimmed")
	}
	if !left["old-pinned"] {
		t.Errorf("pinned peer must NEVER be trimmed regardless of age")
	}
	if !left["fresh-unpinned"] {
		t.Errorf("recently-seen unpinned peer must be preserved")
	}
}

// ---------------------------------------------------------------------------
// KeyRotationFinalizer — clears `_prev` slot once the dual-sign
// grace window has elapsed; leaves it alone otherwise.
// ---------------------------------------------------------------------------

func TestKeyRotationFinalizer_Integration_ClearsPrevAfterGrace(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	rotated := now.Add(-25 * time.Hour) // 1h beyond a 24h grace

	store := federation.NewKeyStoreGORM(integrationDBName)
	current, err := federation.MintLocalKey(now)
	if err != nil {
		t.Fatalf("mint current: %v", err)
	}
	if err := store.PutCurrent(ctx, current); err != nil {
		t.Fatalf("put current: %v", err)
	}
	prev, err := federation.MintLocalKey(rotated)
	if err != nil {
		t.Fatalf("mint prev: %v", err)
	}
	// Stamp prev directly so GeneratedAt sits in the past — the
	// store API has no "set prev" verb because production never
	// rolls back a rotation, but tests need the trip wire.
	if err := db.Create(&federation.AuthLocalKeyRow{
		Slot:        federation.SlotPrev,
		Kid:         prev.Kid,
		PrivPEM:     prev.PrivPEM,
		PubPEM:      prev.PubPEM,
		GeneratedAt: rotated,
		UpdatedAt:   rotated,
	}).Error; err != nil {
		t.Fatalf("seed prev row: %v", err)
	}

	final, err := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys:     store,
		Audit:    repo.NewAuditRepository(integrationDBName),
		Grace:    24 * time.Hour,
		Interval: time.Hour,
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewKeyRotationFinalizer: %v", err)
	}
	if err := final.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	var row federation.AuthLocalKeyRow
	err = db.Where("slot = ?", federation.SlotPrev).Take(&row).Error
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Errorf("prev slot should be cleared after grace, got err=%v row=%+v", err, row)
	}
}

func TestKeyRotationFinalizer_Integration_LeavesPrevWithinGrace(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	rotated := now.Add(-time.Hour) // well inside a 24h grace

	store := federation.NewKeyStoreGORM(integrationDBName)
	prev, err := federation.MintLocalKey(rotated)
	if err != nil {
		t.Fatalf("mint prev: %v", err)
	}
	if err := db.Create(&federation.AuthLocalKeyRow{
		Slot:        federation.SlotPrev,
		Kid:         prev.Kid,
		PrivPEM:     prev.PrivPEM,
		PubPEM:      prev.PubPEM,
		GeneratedAt: rotated,
		UpdatedAt:   rotated,
	}).Error; err != nil {
		t.Fatalf("seed prev row: %v", err)
	}

	final, err := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys:     store,
		Audit:    repo.NewAuditRepository(integrationDBName),
		Grace:    24 * time.Hour,
		Interval: time.Hour,
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewKeyRotationFinalizer: %v", err)
	}
	if err := final.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	var stillThere federation.AuthLocalKeyRow
	if err := db.Where("slot = ?", federation.SlotPrev).Take(&stillThere).Error; err != nil {
		t.Errorf("prev slot must NOT be cleared inside the grace window: %v", err)
	}
}

// ---------------------------------------------------------------------------
// AuditTrim — soft-deletes rows older than the configured
// retention; recent rows untouched.
// ---------------------------------------------------------------------------

func TestAuditTrim_Integration_RemovesOldRows(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	ctx := context.Background()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	retention := 30 * 24 * time.Hour

	rows := []ossmodel.Audit{
		{Action: "upload", Outcome: "ok", Reason: "old", TS: now.Add(-90 * 24 * time.Hour)},
		{Action: "upload", Outcome: "ok", Reason: "stale", TS: now.Add(-40 * 24 * time.Hour)},
		{Action: "upload", Outcome: "ok", Reason: "fresh", TS: now.Add(-time.Hour)},
	}
	for _, r := range rows {
		if err := db.Create(&r).Error; err != nil {
			t.Fatalf("seed audit %s: %v", r.Reason, err)
		}
	}

	trim, err := NewAuditTrim(AuditTrimConfig{
		Audit:     repo.NewAuditRepository(integrationDBName),
		Retention: retention,
		Interval:  24 * time.Hour,
		Now:       func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuditTrim: %v", err)
	}
	if err := trim.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	var remaining []ossmodel.Audit
	if err := db.Where("reason IN ?", []string{"old", "stale", "fresh"}).Find(&remaining).Error; err != nil {
		t.Fatalf("read audit: %v", err)
	}
	leftByReason := map[string]bool{}
	for _, r := range remaining {
		leftByReason[r.Reason] = true
	}
	if leftByReason["old"] {
		t.Errorf("audit row beyond retention must be trimmed: old")
	}
	if leftByReason["stale"] {
		t.Errorf("audit row beyond retention must be trimmed: stale")
	}
	if !leftByReason["fresh"] {
		t.Errorf("audit row inside retention must be preserved: fresh")
	}
}

// Sanity: the integration store fixture wires up correctly even if
// no test seeds anything. Useful as a smoke test if a future
// refactor breaks the AutoMigrate or InjectStore call.
func TestIntegrationStoreFixture_Wires(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	for _, tbl := range []string{"oss_files", "oss_buckets", "oss_audit"} {
		if !db.Migrator().HasTable(tbl) {
			t.Errorf("integration store missing table %q", tbl)
		}
	}
	// Verify the global store resolved by the repo path returns
	// the same handle.
	got, err := store.GetRDS(context.Background(), store.WithRDSDBName(integrationDBName))
	if err != nil {
		t.Fatalf("GetRDS: %v", err)
	}
	if got != db {
		t.Errorf("store mismatch: GetRDS returned a different handle (%p vs %p)", got, db)
	}
}
