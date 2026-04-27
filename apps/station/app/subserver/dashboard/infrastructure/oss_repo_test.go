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

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
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
		&ossmodel.PeerKey{},
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
		ossmodel.Bucket{ID: "b1", Name: "chat", OwnerActorID: "actor-a", Kind: "system", SystemKey: "chat", DefaultVisibility: "chat", QuotaBytes: 100, UsedBytes: 30},
		ossmodel.Bucket{ID: "b2", Name: "personal", OwnerActorID: "actor-b", Kind: "system", SystemKey: "personal", DefaultVisibility: "private", QuotaBytes: 200, UsedBytes: 0},
	)
	seedFiles(t, db,
		ossmodel.FileMeta{Key: "k1", Name: "a.txt", BucketID: "b1", OwnerActorID: "actor-a", Visibility: "chat", Backend: "local", Size: 10},
		ossmodel.FileMeta{Key: "k2", Name: "b.txt", BucketID: "b1", OwnerActorID: "actor-a", Visibility: "chat", Backend: "local", Size: 20},
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
		ossmodel.FileMeta{Key: "kA", Name: "1", BucketID: "b1", OwnerActorID: "actor-a", Visibility: "public", Mime: "image/png", Backend: "local", Size: 10},
		ossmodel.FileMeta{Key: "kB", Name: "2", BucketID: "b1", OwnerActorID: "actor-a", Visibility: "private", Mime: "image/png", Backend: "local", Size: 20},
		ossmodel.FileMeta{Key: "kC", Name: "3", BucketID: "b2", OwnerActorID: "actor-b", Visibility: "chat", Mime: "text/plain", Backend: "s3", Size: 30},
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
		ossmodel.Audit{TS: now.Add(-3 * time.Hour), Action: "get", Outcome: "ok", FileKey: "k1", BucketID: "b1", ActorID: "actor-a"},
		ossmodel.Audit{TS: now.Add(-2 * time.Hour), Action: "get", Outcome: "denied", FileKey: "k1", BucketID: "b1", ActorID: "actor-b", Reason: "not_in_session"},
		ossmodel.Audit{TS: now.Add(-1 * time.Hour), Action: "upload", Outcome: "ok", FileKey: "k2", BucketID: "b1", ActorID: "actor-a"},
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
		ossmodel.Bucket{ID: "b1", Name: "chat", OwnerActorID: "actor-a", Kind: "system", SystemKey: "chat"},
		ossmodel.Bucket{ID: "b2", Name: "chat", OwnerActorID: "actor-b", Kind: "system", SystemKey: "chat"},
	)
	seedFiles(t, db,
		ossmodel.FileMeta{Key: "k1", BucketID: "b1", OwnerActorID: "actor-a", Visibility: "public", Backend: "local", Size: 100},
		ossmodel.FileMeta{Key: "k2", BucketID: "b1", OwnerActorID: "actor-a", Visibility: "chat", Backend: "local", Size: 50},
		ossmodel.FileMeta{Key: "k3", BucketID: "b2", OwnerActorID: "actor-b", Visibility: "private", Backend: "local", Size: 25},
	)

	usage, err := repo.Usage(context.Background())
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if usage.TotalBytes != 175 || usage.TotalFiles != 3 || usage.BucketCount != 2 {
		t.Errorf("totals: %+v", usage)
	}
	if len(usage.TopOwners) == 0 || usage.TopOwners[0].OwnerActorID != "actor-a" || usage.TopOwners[0].Bytes != 150 {
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

	if err := db.Create(&ossmodel.Meta{Key: ossmodel.MetaKeyFederationPubKey, Value: "PEM"}).Error; err != nil {
		t.Fatalf("seed pub: %v", err)
	}
	if err := db.Create(&ossmodel.Meta{Key: ossmodel.MetaKeyFederationKID, Value: "kid-1"}).Error; err != nil {
		t.Fatalf("seed kid: %v", err)
	}

	got, err = repo.GetFederationLocal(context.Background())
	if err != nil {
		t.Fatalf("GetFederationLocal seeded: %v", err)
	}
	if !got.Generated || got.PublicKeyPEM != "PEM" || got.KID != "kid-1" {
		t.Errorf("seeded federation: %+v", got)
	}

	now := time.Now().UTC()
	if err := db.Create(&ossmodel.PeerKey{
		PeerStationID: "peer-1",
		KID:           "kid-x",
		PublicKeyPEM:  "PEER-PEM",
		FirstSeenAt:   now.Add(-time.Hour),
		LastSeenAt:    now,
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
