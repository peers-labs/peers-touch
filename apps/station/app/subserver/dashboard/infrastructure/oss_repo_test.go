// Tests for the dashboard-side OSSRepository. These exercise the
// projection rules over a sqlite ":memory:" handle. We deliberately
// migrate the OSS subserver's GORM models here (and not via a test
// helper that lives in oss/db/repo) so the dashboard package
// continues to depend only on shared DB conventions, not on the
// OSS subserver's repo APIs.
package infrastructure

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newOSSTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&ossmodel.FileMeta{},
		&ossmodel.Bucket{},
		&ossmodel.Audit{},
		&ossmodel.Meta{},
		&federation.AuthLocalKeyRow{},
		&federation.PeerKeyRow{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func seedBuckets(t *testing.T, db *gorm.DB, rows ...ossmodel.Bucket) {
	t.Helper()
	for i := range rows {
		if rows[i].CreatedAt.IsZero() {
			rows[i].CreatedAt = time.Now()
		}
		if rows[i].UpdatedAt.IsZero() {
			rows[i].UpdatedAt = time.Now()
		}
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("seed bucket: %v", err)
		}
	}
}

func seedFiles(t *testing.T, db *gorm.DB, rows ...ossmodel.FileMeta) {
	t.Helper()
	for i := range rows {
		// FileMeta.ID is a string PK; the production code path
		// fills it via ULID. For tests the only constraint is
		// uniqueness, so we synthesise from the key.
		if rows[i].ID == "" {
			rows[i].ID = "id-" + rows[i].Key
		}
		if rows[i].CreatedAt.IsZero() {
			rows[i].CreatedAt = time.Now()
		}
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("seed file: %v", err)
		}
	}
}

func seedAudit(t *testing.T, db *gorm.DB, rows ...ossmodel.Audit) {
	t.Helper()
	for i := range rows {
		if rows[i].TS.IsZero() {
			rows[i].TS = time.Now()
		}
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("seed audit: %v", err)
		}
	}
}

func TestOSSRepository_ListAndGetBuckets(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)

	seedBuckets(t, db,
		ossmodel.Bucket{ID: "b1", Name: "chat", OwnerPTID: "actor-a", Kind: "system", SystemKey: "chat", DefaultVisibility: "chat", QuotaBytes: 100, UsedBytes: 30},
		ossmodel.Bucket{ID: "b2", Name: "personal", OwnerPTID: "actor-b", Kind: "system", SystemKey: "personal", DefaultVisibility: "private", QuotaBytes: 200, UsedBytes: 0},
	)
	seedFiles(t, db,
		ossmodel.FileMeta{Key: "k1", Name: "a.txt", BucketID: "b1", OwnerPTID: "actor-a", Visibility: "chat", Backend: "local", Size: 10},
		ossmodel.FileMeta{Key: "k2", Name: "b.txt", BucketID: "b1", OwnerPTID: "actor-a", Visibility: "chat", Backend: "local", Size: 20},
	)

	rows, err := repo.ListBuckets(context.Background())
	if err != nil {
		t.Fatalf("ListBuckets: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 buckets, got %d", len(rows))
	}
	// The repo MUST return file counts joined per bucket; the two
	// seeded files both belong to b1, none to b2.
	for _, r := range rows {
		switch r.ID {
		case "b1":
			if r.FileCount != 2 {
				t.Errorf("bucket b1 file_count: want 2, got %d", r.FileCount)
			}
		case "b2":
			if r.FileCount != 0 {
				t.Errorf("bucket b2 file_count: want 0, got %d", r.FileCount)
			}
		}
	}

	got, err := repo.GetBucket(context.Background(), "b1")
	if err != nil || got == nil {
		t.Fatalf("GetBucket b1: err=%v row=%v", err, got)
	}
	if got.FileCount != 2 || got.UsedBytes != 30 {
		t.Errorf("GetBucket b1 mismatch: %+v", got)
	}

	miss, err := repo.GetBucket(context.Background(), "no-such")
	if err != nil {
		t.Fatalf("GetBucket miss: unexpected err %v", err)
	}
	if miss != nil {
		t.Errorf("missing bucket should return nil, got %+v", miss)
	}
}

func TestOSSRepository_ListObjects_Filters(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)

	seedFiles(t, db,
		ossmodel.FileMeta{Key: "kA", Name: "1", BucketID: "b1", OwnerPTID: "actor-a", Visibility: "public", Mime: "image/png", Backend: "local", Size: 10},
		ossmodel.FileMeta{Key: "kB", Name: "2", BucketID: "b1", OwnerPTID: "actor-a", Visibility: "private", Mime: "image/png", Backend: "local", Size: 20},
		ossmodel.FileMeta{Key: "kC", Name: "3", BucketID: "b2", OwnerPTID: "actor-b", Visibility: "chat", Mime: "text/plain", Backend: "s3", Size: 30},
	)

	rows, total, err := repo.ListObjects(context.Background(), OSSObjectQuery{BucketID: "b1", Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("ListObjects: %v", err)
	}
	if total != 2 || len(rows) != 2 {
		t.Errorf("bucket filter: want 2/2, got %d/%d", total, len(rows))
	}

	rows, _, err = repo.ListObjects(context.Background(), OSSObjectQuery{Visibility: "public", Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("ListObjects public: %v", err)
	}
	if len(rows) != 1 || rows[0].Visibility != "public" {
		t.Errorf("visibility filter: %+v", rows)
	}

	rows, _, err = repo.ListObjects(context.Background(), OSSObjectQuery{Mime: "text/plain", Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("ListObjects mime: %v", err)
	}
	if len(rows) != 1 || rows[0].Backend != "s3" {
		t.Errorf("mime filter: %+v", rows)
	}
}

func TestOSSRepository_ListAudit_FiltersAndPaging(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)

	now := time.Now().UTC().Truncate(time.Second)
	seedAudit(t, db,
		ossmodel.Audit{TS: now.Add(-3 * time.Hour), Action: "get", Outcome: "ok", FileKey: "k1", BucketID: "b1", ActorPTID: "actor-a"},
		ossmodel.Audit{TS: now.Add(-2 * time.Hour), Action: "get", Outcome: "denied", FileKey: "k1", BucketID: "b1", ActorPTID: "actor-b", Reason: "not_in_session"},
		ossmodel.Audit{TS: now.Add(-1 * time.Hour), Action: "upload", Outcome: "ok", FileKey: "k2", BucketID: "b1", ActorPTID: "actor-a"},
	)

	rows, total, err := repo.ListAudit(context.Background(), OSSAuditQuery{Outcome: "denied", Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("ListAudit denied: %v", err)
	}
	if total != 1 || len(rows) != 1 || rows[0].Reason != "not_in_session" {
		t.Errorf("denied filter: %+v", rows)
	}

	// Time window — capture only the last two events.
	rows, total, err = repo.ListAudit(context.Background(), OSSAuditQuery{Since: now.Add(-150 * time.Minute), Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("ListAudit since: %v", err)
	}
	if total != 2 || len(rows) != 2 {
		t.Errorf("since filter: total=%d rows=%d", total, len(rows))
	}

	// Paging — page_size=1 means 3 total, page 2 returns one row.
	rows, total, err = repo.ListAudit(context.Background(), OSSAuditQuery{Page: 2, PageSize: 1})
	if err != nil {
		t.Fatalf("ListAudit page2: %v", err)
	}
	if total != 3 || len(rows) != 1 {
		t.Errorf("paging: total=%d rows=%d", total, len(rows))
	}
}

func TestOSSRepository_Usage(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)

	seedBuckets(t, db,
		ossmodel.Bucket{ID: "b1", Name: "chat", OwnerPTID: "actor-a", Kind: "system", SystemKey: "chat"},
		ossmodel.Bucket{ID: "b2", Name: "chat", OwnerPTID: "actor-b", Kind: "system", SystemKey: "chat"},
	)
	seedFiles(t, db,
		ossmodel.FileMeta{Key: "k1", BucketID: "b1", OwnerPTID: "actor-a", Visibility: "public", Backend: "local", Size: 100},
		ossmodel.FileMeta{Key: "k2", BucketID: "b1", OwnerPTID: "actor-a", Visibility: "chat", Backend: "local", Size: 50},
		ossmodel.FileMeta{Key: "k3", BucketID: "b2", OwnerPTID: "actor-b", Visibility: "private", Backend: "local", Size: 25},
	)

	usage, err := repo.Usage(context.Background())
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if usage.TotalBytes != 175 || usage.TotalFiles != 3 || usage.BucketCount != 2 {
		t.Errorf("totals: %+v", usage)
	}
	if len(usage.TopOwners) == 0 || usage.TopOwners[0].OwnerPTID != "actor-a" || usage.TopOwners[0].Bytes != 150 {
		t.Errorf("top owners: %+v", usage.TopOwners)
	}
	if len(usage.VisibilityMix) != 3 {
		t.Errorf("visibility mix: %+v", usage.VisibilityMix)
	}
}

func TestOSSRepository_FederationLocalAndPeers(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)

	// Federation-me reads two oss_meta keys (pub + kid). When neither
	// is set, the response is `{generated:false}` — that path is what
	// fresh stations look like the first time the dashboard polls.
	got, err := repo.GetFederationLocal(context.Background())
	if err != nil {
		t.Fatalf("GetFederationLocal empty: %v", err)
	}
	if got.Generated || got.PublicKeyPEM != "" || got.KID != "" {
		t.Errorf("empty federation should be ungenerated: %+v", got)
	}

	now := time.Now().UTC()
	mintedKey, err := federation.MintLocalKey(now)
	if err != nil {
		t.Fatalf("mint local key: %v", err)
	}
	if err := db.Create(&federation.AuthLocalKeyRow{
		Slot: federation.SlotCurrent, Kid: mintedKey.Kid,
		PrivPEM: mintedKey.PrivPEM, PubPEM: mintedKey.PubPEM,
		GeneratedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed local key: %v", err)
	}

	got, err = repo.GetFederationLocal(context.Background())
	if err != nil {
		t.Fatalf("GetFederationLocal seeded: %v", err)
	}
	if !got.Generated || got.PublicKeyPEM != mintedKey.PubPEM || got.KID != mintedKey.Kid {
		t.Errorf("seeded federation: %+v", got)
	}

	if err := db.Create(&federation.PeerKeyRow{
		StationID: "peer-1", Kid: "kid-x", PubPEM: "PEER-PEM",
		FirstSeenAt: now.Add(-time.Hour), LastSeenAt: now,
	}).Error; err != nil {
		t.Fatalf("seed peer: %v", err)
	}

	peers, err := repo.ListFederationPeers(context.Background())
	if err != nil {
		t.Fatalf("ListFederationPeers: %v", err)
	}
	if len(peers) != 1 || peers[0].PeerStationID != "peer-1" {
		t.Fatalf("peers: %+v", peers)
	}
	if peers[0].Pinned {
		t.Errorf("new peer should not be pinned by default: %+v", peers[0])
	}

	if err := repo.SetPeerPin(context.Background(), "peer-1", true); err != nil {
		t.Fatalf("pin peer: %v", err)
	}
	peers, _ = repo.ListFederationPeers(context.Background())
	if !peers[0].Pinned {
		t.Errorf("peer should now be pinned: %+v", peers[0])
	}

	if err := repo.SetPeerPin(context.Background(), "no-such", true); err != ErrPeerNotFound {
		t.Errorf("pin missing peer: want ErrPeerNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// S9: bucket lifecycle (admin) — CreateBucket / UpdateBucket / DeleteBucket
//
// These exercise the dashboard's own writes (it does NOT delegate to the
// OSS subserver's repo). We verify the repo respects the same
// (owner, name) uniqueness, refuses non-empty buckets without `force`,
// and never deletes system buckets.
// ---------------------------------------------------------------------------

func TestOSSRepository_CreateBucket_HappyAndConflict(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	got, err := repo.CreateBucket(ctx, BucketCreateInput{
		OwnerPTID:         "actor-x",
		Name:              "photos",
		DefaultVisibility: "private",
		QuotaBytes:        1024,
		TTLDays:           30,
		Description:       "personal albums",
	})
	if err != nil {
		t.Fatalf("CreateBucket happy: %v", err)
	}
	if got == nil || got.OwnerPTID != "actor-x" || got.Name != "photos" {
		t.Fatalf("CreateBucket happy returned %+v", got)
	}
	if got.DefaultVisibility != "private" || got.QuotaBytes != 1024 {
		t.Errorf("CreateBucket persisted wrong values: %+v", got)
	}

	// Same (owner, name) → ErrBucketExists, not a generic error.
	if _, err := repo.CreateBucket(ctx, BucketCreateInput{
		OwnerPTID: "actor-x",
		Name:      "photos",
	}); err != ErrBucketExists {
		t.Errorf("conflict: want ErrBucketExists, got %v", err)
	}

	// Empty owner / name → ErrBucketBadInput at the repo boundary.
	if _, err := repo.CreateBucket(ctx, BucketCreateInput{Name: "x"}); err != ErrBucketBadInput {
		t.Errorf("missing owner: want ErrBucketBadInput, got %v", err)
	}
	if _, err := repo.CreateBucket(ctx, BucketCreateInput{OwnerPTID: "x"}); err != ErrBucketBadInput {
		t.Errorf("missing name: want ErrBucketBadInput, got %v", err)
	}
}

func TestOSSRepository_UpdateBucket_PartialPatchAndNotFound(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedBuckets(t, db, ossmodel.Bucket{
		ID: "b-update", Name: "photos", OwnerPTID: "actor-x", Kind: "user",
		DefaultVisibility: "private", QuotaBytes: 100, TTLDays: 7, Description: "old",
	})

	newQuota := int64(500)
	newDesc := "new"
	got, err := repo.UpdateBucket(ctx, "b-update", BucketUpdateInput{
		QuotaBytes:  &newQuota,
		Description: &newDesc,
	})
	if err != nil {
		t.Fatalf("UpdateBucket: %v", err)
	}
	if got == nil || got.QuotaBytes != 500 {
		t.Errorf("quota not updated: %+v", got)
	}
	// Untouched columns must remain. We re-query through the repo
	// because UpdateBucket already returned a freshly-projected
	// summary — but Description is on the summary too.
	if got.DefaultVisibility != "private" || got.Name != "photos" {
		t.Errorf("untouched columns drifted: %+v", got)
	}

	// Empty patch → ErrBucketBadInput (repo guards it; the service
	// has its own guard, this protects against a buggy service.)
	if _, err := repo.UpdateBucket(ctx, "b-update", BucketUpdateInput{}); err != ErrBucketBadInput {
		t.Errorf("empty patch: want ErrBucketBadInput, got %v", err)
	}

	if _, err := repo.UpdateBucket(ctx, "no-such", BucketUpdateInput{QuotaBytes: &newQuota}); err != ErrBucketNotFound {
		t.Errorf("missing id: want ErrBucketNotFound, got %v", err)
	}
}

func TestOSSRepository_DeleteBucket_GuardsAndForce(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedBuckets(t, db,
		ossmodel.Bucket{ID: "b-empty", Name: "empty", OwnerPTID: "a", Kind: "user", DefaultVisibility: "private"},
		ossmodel.Bucket{ID: "b-full", Name: "full", OwnerPTID: "a", Kind: "user", DefaultVisibility: "private", ObjectCount: 3, UsedBytes: 999},
		ossmodel.Bucket{ID: "b-system", Name: "chat", OwnerPTID: "a", Kind: "system", SystemKey: "chat", DefaultVisibility: "chat"},
	)

	// Empty + non-force → ok.
	if err := repo.DeleteBucket(ctx, "b-empty", false); err != nil {
		t.Fatalf("delete empty: %v", err)
	}
	got, _ := repo.GetBucket(ctx, "b-empty")
	if got != nil {
		t.Errorf("b-empty should be soft-deleted (not visible via GetBucket): %+v", got)
	}

	// Non-empty + non-force → ErrBucketNotEmpty.
	if err := repo.DeleteBucket(ctx, "b-full", false); err != ErrBucketNotEmpty {
		t.Errorf("delete full no-force: want ErrBucketNotEmpty, got %v", err)
	}

	// Non-empty + force → ok (operator override).
	if err := repo.DeleteBucket(ctx, "b-full", true); err != nil {
		t.Fatalf("delete full force: %v", err)
	}

	// System buckets are NEVER deletable, even with force.
	if err := repo.DeleteBucket(ctx, "b-system", true); err != ErrBucketSystem {
		t.Errorf("delete system force: want ErrBucketSystem, got %v", err)
	}

	// Missing id → ErrBucketNotFound.
	if err := repo.DeleteBucket(ctx, "no-such", false); err != ErrBucketNotFound {
		t.Errorf("delete missing: want ErrBucketNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// S10: object lifecycle (admin) — GetObject / AdminPatchObject / AdminDeleteObject
// ---------------------------------------------------------------------------

func TestOSSRepository_GetObject_FoundAndMissing(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedFiles(t, db, ossmodel.FileMeta{
		ID: "f-1", Key: "k1", Name: "n1", BucketID: "b1", OwnerPTID: "a",
		Visibility: "private", Backend: "local", Size: 7,
	})

	got, err := repo.GetObject(ctx, "f-1")
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	if got == nil || got.ID != "f-1" || got.Key != "k1" || got.Size != 7 {
		t.Fatalf("GetObject: %+v", got)
	}

	miss, err := repo.GetObject(ctx, "no-such")
	if err != nil {
		t.Fatalf("GetObject miss: %v", err)
	}
	if miss != nil {
		t.Errorf("missing object should be nil, got %+v", miss)
	}
}

func TestOSSRepository_AdminPatchObject_UpdatesAndBumpsCapability(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedFiles(t, db, ossmodel.FileMeta{
		ID: "f-1", Key: "k", Name: "n", BucketID: "b", OwnerPTID: "a",
		Visibility: "public", Backend: "local",
	})

	// Tightening public → private MUST bump capability_version.
	priv := "private"
	got, err := repo.AdminPatchObject(ctx, "f-1", AdminPatchObjectInput{Visibility: &priv})
	if err != nil {
		t.Fatalf("AdminPatchObject tighten: %v", err)
	}
	if got == nil || got.Visibility != "private" {
		t.Fatalf("post-patch: %+v", got)
	}
	var capVersion string
	if err := db.Table(tblOSSMeta).Select("value").Where("key = ?", metaKeyCapVersion).
		Scan(&capVersion).Error; err != nil {
		t.Fatalf("read cap version: %v", err)
	}
	if capVersion == "" {
		t.Errorf("capability_version should be set after tighten")
	}

	// A subsequent loosening (private → public) should NOT bump
	// capability_version (loosening is observable on next access).
	pub := "public"
	if _, err := repo.AdminPatchObject(ctx, "f-1", AdminPatchObjectInput{Visibility: &pub}); err != nil {
		t.Fatalf("loosen: %v", err)
	}
	var capVersionAfter string
	_ = db.Table(tblOSSMeta).Select("value").Where("key = ?", metaKeyCapVersion).
		Scan(&capVersionAfter).Error
	if capVersionAfter != capVersion {
		t.Errorf("loosening should not bump cap version: prev=%q now=%q", capVersion, capVersionAfter)
	}
}

func TestOSSRepository_AdminPatchObject_RejectsChatWithoutSession(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedFiles(t, db, ossmodel.FileMeta{
		ID: "f-1", Key: "k", Name: "n", BucketID: "b", OwnerPTID: "a",
		Visibility: "private", Backend: "local",
	})

	chat := "chat"
	if _, err := repo.AdminPatchObject(ctx, "f-1", AdminPatchObjectInput{Visibility: &chat}); err != ErrFileChatNeedsSession {
		t.Errorf("chat without session: want ErrFileChatNeedsSession, got %v", err)
	}

	sess := "sess-1"
	if _, err := repo.AdminPatchObject(ctx, "f-1", AdminPatchObjectInput{
		Visibility:       &chat,
		ChatSessionID:    &sess,
		ChatSessionIDSet: true,
	}); err != nil {
		t.Errorf("chat with session: unexpected err %v", err)
	}
}

func TestOSSRepository_AdminPatchObject_AwayFromChatClearsSession(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedFiles(t, db, ossmodel.FileMeta{
		ID: "f-1", Key: "k", Name: "n", BucketID: "b", OwnerPTID: "a",
		Visibility: "chat", ChatSessionID: "sess-1", Backend: "local",
	})

	priv := "private"
	got, err := repo.AdminPatchObject(ctx, "f-1", AdminPatchObjectInput{Visibility: &priv})
	if err != nil {
		t.Fatalf("AdminPatchObject: %v", err)
	}
	if got.ChatSessionID != "" {
		t.Errorf("session_id should be cleared after move away from chat: %+v", got)
	}
}

func TestOSSRepository_AdminPatchObject_RejectsDeletedRow(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	now := time.Now()
	seedFiles(t, db, ossmodel.FileMeta{
		ID: "f-1", Key: "k", Name: "n", BucketID: "b", OwnerPTID: "a",
		Visibility: "private", Backend: "local", DeletedAt: &now,
	})

	priv := "private"
	if _, err := repo.AdminPatchObject(ctx, "f-1", AdminPatchObjectInput{Visibility: &priv}); err != ErrFileAlreadyDeleted {
		t.Errorf("patch deleted: want ErrFileAlreadyDeleted, got %v", err)
	}
}

func TestOSSRepository_AdminDeleteObject_HappyAndIdempotent(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	seedFiles(t, db, ossmodel.FileMeta{
		ID: "f-1", Key: "k", Name: "n", BucketID: "b", OwnerPTID: "a",
		Visibility: "private", Backend: "local",
	})

	got, err := repo.AdminDeleteObject(ctx, "f-1")
	if err != nil {
		t.Fatalf("AdminDeleteObject: %v", err)
	}
	if got == nil || got.DeletedAt == nil {
		t.Errorf("post-delete row should carry deleted_at: %+v", got)
	}

	// Second delete must be idempotent: returns the row + ErrFileAlreadyDeleted.
	got2, err2 := repo.AdminDeleteObject(ctx, "f-1")
	if err2 != ErrFileAlreadyDeleted {
		t.Errorf("idempotent re-delete: want ErrFileAlreadyDeleted, got %v", err2)
	}
	if got2 == nil || got2.ID != "f-1" {
		t.Errorf("idempotent re-delete should still return row: %+v", got2)
	}

	// Missing id stays a clean NotFound.
	if _, err := repo.AdminDeleteObject(ctx, "no-such"); err != ErrFileNotFound {
		t.Errorf("missing id: want ErrFileNotFound, got %v", err)
	}
}

func TestOSSRepository_RecordOSSAudit_AppendsRow(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	if err := repo.RecordOSSAudit(ctx, OSSAuditAppend{
		Action:           "bucket_create",
		BucketID:         "b-1",
		ActorPTID:        "actor-x",
		DashboardActorID: "42",
		Outcome:          "ok",
	}); err != nil {
		t.Fatalf("RecordOSSAudit: %v", err)
	}

	rows, total, err := repo.ListAudit(ctx, OSSAuditQuery{Action: "bucket_create", Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if total != 1 || len(rows) != 1 {
		t.Fatalf("expected 1 row, got total=%d rows=%d", total, len(rows))
	}
	if rows[0].BucketID != "b-1" || rows[0].ActorPTID != "actor-x" || rows[0].Outcome != "ok" {
		t.Errorf("row mismatch: %+v", rows[0])
	}
}

// ---------------------------------------------------------------------------
// S13: federation rotate-local-key
// ---------------------------------------------------------------------------

// readSlotForTest is a tiny helper that pokes the framework's
// `auth_local_keys` table directly to confirm a rotation wrote
// the expected slot. The on-disk shape is the contract — we do
// not go through the framework's KeyStore so this test sees the
// truth even if the iface ever changes.
func readSlotForTest(t *testing.T, db *gorm.DB, slot string) federation.AuthLocalKeyRow {
	t.Helper()
	var row federation.AuthLocalKeyRow
	if err := db.Where("slot = ?", slot).Take(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return federation.AuthLocalKeyRow{}
		}
		t.Fatalf("read slot %q: %v", slot, err)
	}
	return row
}

func TestOSSRepository_RotateFederationLocalKey_FirstRotationGreenfield(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	resp, err := repo.RotateFederationLocalKey(ctx)
	if err != nil {
		t.Fatalf("RotateFederationLocalKey: %v", err)
	}
	if resp == nil || resp.NewKID == "" {
		t.Fatalf("expected non-empty new kid; got %+v", resp)
	}
	if resp.PreviousKID != "" {
		t.Errorf("greenfield rotation should not echo a previous kid: %q", resp.PreviousKID)
	}
	if resp.RotatedAt.IsZero() {
		t.Errorf("rotated_at must be set")
	}
	if resp.CapabilityVersion == "" {
		t.Errorf("capability_version must be bumped on rotation")
	}

	cur := readSlotForTest(t, db, federation.SlotCurrent)
	if cur.Kid != resp.NewKID {
		t.Errorf("current slot kid: got %q want %q", cur.Kid, resp.NewKID)
	}
	if cur.PrivPEM == "" || cur.PubPEM == "" {
		t.Errorf("current slot must carry priv+pub PEM; got %+v", cur)
	}
	prev := readSlotForTest(t, db, federation.SlotPrev)
	if prev.Kid != "" {
		t.Errorf("greenfield rotation must not write prev slot: %+v", prev)
	}
}

func TestOSSRepository_RotateFederationLocalKey_DemotesPrevious(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	first, err := repo.RotateFederationLocalKey(ctx)
	if err != nil {
		t.Fatalf("seed rotation: %v", err)
	}
	firstCur := readSlotForTest(t, db, federation.SlotCurrent)
	firstPriv := firstCur.PrivPEM
	if firstPriv == "" {
		t.Fatalf("seed priv missing")
	}

	second, err := repo.RotateFederationLocalKey(ctx)
	if err != nil {
		t.Fatalf("rotate again: %v", err)
	}
	if second.PreviousKID != first.NewKID {
		t.Errorf("second rotation prev_kid: got %q want %q", second.PreviousKID, first.NewKID)
	}
	if second.NewKID == first.NewKID {
		t.Errorf("rotation should produce a new kid; got identical %q", second.NewKID)
	}

	prev := readSlotForTest(t, db, federation.SlotPrev)
	if prev.Kid != first.NewKID {
		t.Errorf("prev slot kid: got %q want %q", prev.Kid, first.NewKID)
	}
	if prev.PrivPEM != firstPriv {
		t.Errorf("prev slot priv: should hold the demoted priv, got mismatch")
	}

	cur := readSlotForTest(t, db, federation.SlotCurrent)
	if cur.Kid != second.NewKID {
		t.Errorf("canonical KID after rotate: got %q want %q", cur.Kid, second.NewKID)
	}
	if cur.PrivPEM == firstPriv {
		t.Errorf("canonical priv was not rotated")
	}
}

// ---------------------------------------------------------------------------
// S15: ForgetPeer + ListWorkers projection
// ---------------------------------------------------------------------------

func TestOSSRepository_ForgetPeer_DropsRowAndIsIdempotent(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	now := time.Now().UTC()
	if err := db.Create(&federation.PeerKeyRow{
		StationID: "peer-1", Kid: "kid-1", PubPEM: "PEM",
		FirstSeenAt: now, LastSeenAt: now, Pinned: true,
	}).Error; err != nil {
		t.Fatalf("seed peer: %v", err)
	}

	// First forget removes the row, even though it is pinned —
	// pin only protects against silent rotation, NOT the
	// operator's explicit forget intent.
	if err := repo.ForgetPeer(ctx, "peer-1"); err != nil {
		t.Fatalf("ForgetPeer: %v", err)
	}
	peers, _ := repo.ListFederationPeers(ctx)
	if len(peers) != 0 {
		t.Errorf("expected peer to be gone, got %+v", peers)
	}

	// Second forget on a missing peer must not error — idempotent.
	if err := repo.ForgetPeer(ctx, "peer-1"); err != nil {
		t.Errorf("idempotent re-forget should succeed, got %v", err)
	}

	// Empty peer id is rejected as a guard against accidental
	// "forget all" requests from a buggy UI.
	if err := repo.ForgetPeer(ctx, ""); err != ErrPeerNotFound {
		t.Errorf("empty peer id: want ErrPeerNotFound, got %v", err)
	}
}

func TestOSSRepository_ListWorkers_ProjectsHeartbeats(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	now := time.Now().UTC()
	seedAudit(t, db,
		// Two ttl_sweeper runs: an older success then a fresh error.
		ossmodel.Audit{Action: "worker_run", Outcome: "ok", Reason: "ttl_sweeper", TS: now.Add(-2 * time.Hour)},
		ossmodel.Audit{Action: "worker_run", Outcome: "error", Reason: "ttl_sweeper: kaboom: timeout", TS: now.Add(-30 * time.Minute)},
		// One blob_gc success — should appear with no error.
		ossmodel.Audit{Action: "worker_run", Outcome: "ok", Reason: "blob_gc", TS: now.Add(-time.Hour)},
		// Off-action row — must be ignored even if it mentions a worker name.
		ossmodel.Audit{Action: "delete", Outcome: "ok", Reason: "ttl_sweeper", TS: now.Add(-time.Minute)},
		// Outside the lookback window — must be ignored.
		ossmodel.Audit{Action: "worker_run", Outcome: "ok", Reason: "ttl_sweeper", TS: now.Add(-72 * time.Hour)},
	)

	got, err := repo.ListWorkers(ctx, 24*time.Hour)
	if err != nil {
		t.Fatalf("ListWorkers: %v", err)
	}
	if got == nil {
		t.Fatalf("nil response")
	}
	if got.LookbackHours != 24 {
		t.Errorf("LookbackHours: got %v want 24", got.LookbackHours)
	}
	if len(got.Items) != 2 {
		t.Fatalf("workers count: got %d (%+v) want 2", len(got.Items), got.Items)
	}

	byName := map[string]domain.OSSWorkerHeartbeat{}
	for _, h := range got.Items {
		byName[h.Name] = h
	}
	ttl := byName["ttl_sweeper"]
	if ttl.RunCount != 2 {
		t.Errorf("ttl_sweeper RunCount: got %d want 2", ttl.RunCount)
	}
	if ttl.ErrorCount != 1 {
		t.Errorf("ttl_sweeper ErrorCount: got %d want 1", ttl.ErrorCount)
	}
	if ttl.LastOutcome != "error" {
		t.Errorf("ttl_sweeper LastOutcome: got %q want error", ttl.LastOutcome)
	}
	if ttl.LastError != "kaboom: timeout" {
		t.Errorf("ttl_sweeper LastError: got %q want %q (the colon-after-prefix should be preserved)",
			ttl.LastError, "kaboom: timeout")
	}

	gc := byName["blob_gc"]
	if gc.RunCount != 1 || gc.ErrorCount != 0 || gc.LastOutcome != "ok" || gc.LastError != "" {
		t.Errorf("blob_gc projection wrong: %+v", gc)
	}
}

func TestOSSRepository_ListWorkers_DefaultsLookbackTo24h(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	got, err := repo.ListWorkers(ctx, 0)
	if err != nil {
		t.Fatalf("ListWorkers: %v", err)
	}
	if got.LookbackHours != 24 {
		t.Errorf("zero lookback should default to 24h, got %v", got.LookbackHours)
	}
}

func TestParseWorkerHeartbeatReason(t *testing.T) {
	cases := []struct {
		in, name, msg string
	}{
		{"ttl_sweeper", "ttl_sweeper", ""},
		{"blob_gc: oh no", "blob_gc", "oh no"},
		{"key_rotate: error: timed out", "key_rotate", "error: timed out"},
		{"  trimmed  ", "trimmed", ""},
		{"", "", ""},
	}
	for _, tc := range cases {
		gotName, gotMsg := parseWorkerHeartbeatReason(tc.in)
		if gotName != tc.name || gotMsg != tc.msg {
			t.Errorf("parseWorkerHeartbeatReason(%q): got (%q, %q) want (%q, %q)",
				tc.in, gotName, gotMsg, tc.name, tc.msg)
		}
	}
}

func TestOSSRepository_RotateFederationLocalKey_BumpsCapabilityVersion(t *testing.T) {
	db := newOSSTestDB(t)
	repo := NewOSSRepository(db)
	ctx := context.Background()

	// Seed an initial capability_version so we can prove the
	// rotation overwrote it. Without a seed the first rotation
	// would be the row's first write, which is also "bumped" but
	// not as informative for the assertion.
	if err := db.Create(&ossmodel.Meta{
		Key: metaKeyCapVersion, Value: "before-rotate", UpdatedAt: time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed capability_version: %v", err)
	}

	resp, err := repo.RotateFederationLocalKey(ctx)
	if err != nil {
		t.Fatalf("RotateFederationLocalKey: %v", err)
	}
	if resp.CapabilityVersion == "" || resp.CapabilityVersion == "before-rotate" {
		t.Errorf("capability_version must change on rotation: %q", resp.CapabilityVersion)
	}

	var row ossmodel.Meta
	if err := db.Where("key = ?", metaKeyCapVersion).Take(&row).Error; err != nil {
		t.Fatalf("read capability_version: %v", err)
	}
	if row.Value != resp.CapabilityVersion {
		t.Errorf("capability_version on disk: got %q want %q", row.Value, resp.CapabilityVersion)
	}
}
