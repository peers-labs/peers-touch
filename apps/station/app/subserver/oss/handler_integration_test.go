// End-to-end integration tests for the OSS subserver's HTTP
// handlers. Unlike `handler_test.go` (which stubs the FileService
// to focus on transport-layer behaviour), this suite wires the
// REAL service+repo stack against an in-memory sqlite handle so
// the lifecycle round-trip exercises every layer.
//
// Why a separate file? Mixing live-DB tests into the existing
// stub-driven suite would force every contributor to think about
// schema state when they only intended to test a 401 path. The
// split keeps fast unit tests fast while letting us guarantee the
// handler→service→repo→DB chain stays glued together.
package oss

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// In-process store fixture
// ---------------------------------------------------------------------------

const ossIntegrationDBName = "oss-handler-integration"

type ossIntegStore struct{ db *gorm.DB }

func (s *ossIntegStore) Init(_ context.Context, _ ...option.Option) error { return nil }
func (s *ossIntegStore) RDS(_ context.Context, _ ...store.RDSDMLOption) (*gorm.DB, error) {
	return s.db, nil
}
func (s *ossIntegStore) Name() string { return "oss-handler-integration-store" }

var (
	ossIntegOnce sync.Once
	ossIntegDB   *gorm.DB
	ossIntegErr  error
)

func initOSSIntegStore(t *testing.T) *gorm.DB {
	t.Helper()
	ossIntegOnce.Do(func() {
		ossIntegDB, ossIntegErr = gorm.Open(
			sqlite.Open("file:osshandlerinteg?mode=memory&cache=shared"),
			&gorm.Config{},
		)
		if ossIntegErr != nil {
			return
		}
		ossIntegErr = ossIntegDB.AutoMigrate(
			&ossmodel.FileMeta{},
			&ossmodel.Bucket{},
			&ossmodel.Audit{},
			&ossmodel.Meta{},
			&ossmodel.Blob{},
			&federation.AuthLocalKeyRow{},
			&federation.PeerKeyRow{},
		)
		if ossIntegErr != nil {
			return
		}
		_ = store.InjectStore(context.Background(), &ossIntegStore{db: ossIntegDB})
	})
	if ossIntegErr != nil {
		t.Fatalf("init oss handler integration store: %v", ossIntegErr)
	}
	return ossIntegDB
}

func resetOSSInteg(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, tbl := range []string{
		"oss_files", "oss_buckets", "oss_audit",
		"oss_meta", "oss_blobs",
		federation.PeerKeyTable, federation.AuthLocalKeyTable,
	} {
		if err := db.Exec("DELETE FROM " + tbl).Error; err != nil {
			t.Fatalf("reset %s: %v", tbl, err)
		}
	}
}

// ---------------------------------------------------------------------------
// Backend stub — every lifecycle path the handlers exercise reads
// metadata only, so a no-op backend that never returns data is
// enough for the integration suite. The /upload path is NOT
// covered here (file_service_test.go owns that — wiring full
// multipart through a real backend is over-scoped for "did the
// lifecycle wire-up survive a refactor?").
// ---------------------------------------------------------------------------

type integHandlerBackend struct{}

func (integHandlerBackend) Save(context.Context, string, io.Reader) (string, error) {
	return "", errors.New("integHandlerBackend.Save not used in integration suite")
}
func (integHandlerBackend) Open(context.Context, string, *storage.Range) (io.ReadCloser, int64, string, error) {
	return nil, 0, "", errors.New("integHandlerBackend.Open not used")
}
func (integHandlerBackend) Stat(context.Context, string) (*storage.StatInfo, error) {
	return &storage.StatInfo{}, nil
}
func (integHandlerBackend) Healthz(context.Context) error        { return nil }
func (integHandlerBackend) Delete(context.Context, string) error { return nil }

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

// newIntegrationServer wires every collaborator the lifecycle
// handlers actually use against the shared integration DB. The
// remaining ossSubServer fields (federation cache, presigned
// thresholds, scheduler) are left zero — those paths are not part
// of the lifecycle round-trip we intend to exercise.
func newIntegrationServer(t *testing.T) *ossSubServer {
	t.Helper()
	_ = initOSSIntegStore(t)

	files := repo.NewFileRepository(ossIntegrationDBName)
	buckets := repo.NewBucketRepository(ossIntegrationDBName)
	blobs := repo.NewBlobRepository(ossIntegrationDBName)
	audit := repo.NewAuditRepository(ossIntegrationDBName)
	meta := repo.NewMetaRepository(ossIntegrationDBName)
	backend := integHandlerBackend{}

	svc := service.NewFileService(service.Config{
		Files:       files,
		Buckets:     buckets,
		Blobs:       blobs,
		Meta:        meta,
		Backend:     backend,
		BackendName: "local",
	})
	return &ossSubServer{
		pathBase:        "/sub-oss",
		authProvider:    stubAuthProvider{},
		fileService:     svc,
		fileRepo:        files,
		bucketRepo:      buckets,
		auditRepo:       audit,
		blobRepo:        blobs,
		metaRepo:        meta,
		backend:         backend,
		backendType:     "local",
		softDeleteGrace: 7 * 24 * time.Hour,
	}
}

// seedBucket inserts the canonical chat system bucket so file rows
// referencing bucket_id="chat-bucket" satisfy the FK-shaped
// invariants in the service layer.
func seedBucket(t *testing.T, db *gorm.DB, owner string) string {
	t.Helper()
	bucketID := "bk-" + owner
	now := time.Now().UTC()
	if err := db.Create(&ossmodel.Bucket{
		ID: bucketID, Name: "chat", OwnerPTID: owner,
		Kind: "system", SystemKey: "chat", DefaultVisibility: "chat",
		QuotaBytes: 1 << 30, UsedBytes: 0, ObjectCount: 0,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed bucket for %s: %v", owner, err)
	}
	return bucketID
}

// seedFile drops a single CAS-style file row and a matching blob.
// Returns the (key, fileID) tuple so the caller can address it
// from the lifecycle endpoints.
func seedFile(t *testing.T, db *gorm.DB, owner, bucketID, key string, size int64, vis string) (string, string) {
	t.Helper()
	now := time.Now().UTC()
	id := "f-" + key
	if err := db.Create(&ossmodel.FileMeta{
		ID: id, Key: key, Name: "n", BucketID: bucketID,
		OwnerPTID: owner, Visibility: vis, Backend: "local",
		Size: size, CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed file %s: %v", key, err)
	}
	if err := db.Create(&ossmodel.Blob{
		Backend: "local", Key: key, Size: size,
		RefCount: 1, LastSeenAt: now,
	}).Error; err != nil {
		t.Fatalf("seed blob %s: %v", key, err)
	}
	if err := db.Model(&ossmodel.Bucket{}).
		Where("id = ?", bucketID).
		Updates(map[string]any{
			"used_bytes":   gorm.Expr("used_bytes + ?", size),
			"object_count": gorm.Expr("object_count + ?", 1),
		}).Error; err != nil {
		t.Fatalf("bump bucket usage: %v", err)
	}
	return key, id
}

// ---------------------------------------------------------------------------
// End-to-end lifecycle round-trip
//
// Scenario: alice owns one chat-visible file. We exercise the full
// PATCH → DELETE → RESTORE → PATCH chain end-to-end, asserting both
// HTTP semantics AND ground-truth DB state at each step.
// ---------------------------------------------------------------------------

func TestIntegration_Lifecycle_FullRoundTrip(t *testing.T) {
	db := initOSSIntegStore(t)
	resetOSSInteg(t, db)

	server := newIntegrationServer(t)
	owner := "did:test:alice"
	bucketID := seedBucket(t, db, owner)
	key, fileID := seedFile(t, db, owner, bucketID, "cas/aa/lifecycle", 100, "chat")

	// --- Step 1: PATCH visibility chat → public (loosening).
	patchBody := `{"visibility":"public"}`
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPatch,
		"/sub-oss/file?key="+key, stringReader(patchBody)), owner)
	req.Header.Set("Content-Type", "application/json")
	server.handleFilePatch(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH chat→public: got %d body=%s", rec.Code, rec.Body.String())
	}

	var afterPatch ossmodel.FileMeta
	if err := db.Where("id = ?", fileID).Take(&afterPatch).Error; err != nil {
		t.Fatalf("read after patch: %v", err)
	}
	if afterPatch.Visibility != "public" {
		t.Errorf("visibility post-patch: got %q want public", afterPatch.Visibility)
	}

	// --- Step 2: DELETE — expect soft delete + bucket usage debit.
	rec = httptest.NewRecorder()
	req = withSubject(httptest.NewRequest(http.MethodDelete,
		"/sub-oss/file?key="+key, nil), owner)
	server.handleFileDelete(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE: got %d body=%s", rec.Code, rec.Body.String())
	}

	var afterDelete ossmodel.FileMeta
	if err := db.Unscoped().Where("id = ?", fileID).Take(&afterDelete).Error; err != nil {
		t.Fatalf("read after delete: %v", err)
	}
	if afterDelete.DeletedAt == nil {
		t.Errorf("DELETE should soft-delete the row")
	}

	// Bucket usage should drop back to zero (this is the only file).
	var bucketAfterDel ossmodel.Bucket
	if err := db.Where("id = ?", bucketID).Take(&bucketAfterDel).Error; err != nil {
		t.Fatalf("read bucket after delete: %v", err)
	}
	if bucketAfterDel.UsedBytes != 0 {
		t.Errorf("bucket UsedBytes after delete: got %d want 0", bucketAfterDel.UsedBytes)
	}
	if bucketAfterDel.ObjectCount != 0 {
		t.Errorf("bucket ObjectCount after delete: got %d want 0", bucketAfterDel.ObjectCount)
	}

	// --- Step 3: DELETE again — must be idempotent (already_deleted=true).
	rec = httptest.NewRecorder()
	req = withSubject(httptest.NewRequest(http.MethodDelete,
		"/sub-oss/file?key="+key, nil), owner)
	server.handleFileDelete(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("re-DELETE: got %d body=%s", rec.Code, rec.Body.String())
	}
	var reDeleteBody map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &reDeleteBody)
	if reDeleteBody["already_deleted"] != true {
		t.Errorf("re-DELETE should report already_deleted=true, got %v", reDeleteBody["already_deleted"])
	}

	// --- Step 4: PATCH on a deleted row must be rejected (410).
	rec = httptest.NewRecorder()
	req = withSubject(httptest.NewRequest(http.MethodPatch,
		"/sub-oss/file?key="+key, stringReader(`{"visibility":"private"}`)), owner)
	req.Header.Set("Content-Type", "application/json")
	server.handleFilePatch(rec, req)
	if rec.Code != http.StatusGone {
		t.Errorf("PATCH on deleted row: got %d want 410, body=%s", rec.Code, rec.Body.String())
	}

	// --- Step 5: RESTORE — row should come back live, bucket re-credited.
	rec = httptest.NewRecorder()
	req = withSubject(httptest.NewRequest(http.MethodPost,
		"/sub-oss/file/restore?key="+key, nil), owner)
	server.handleFileRestore(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("RESTORE: got %d body=%s", rec.Code, rec.Body.String())
	}
	var afterRestore ossmodel.FileMeta
	if err := db.Where("id = ?", fileID).Take(&afterRestore).Error; err != nil {
		t.Fatalf("read after restore: %v", err)
	}
	if afterRestore.DeletedAt != nil {
		t.Errorf("RESTORE should clear DeletedAt, got %v", afterRestore.DeletedAt)
	}

	var bucketAfterRestore ossmodel.Bucket
	if err := db.Where("id = ?", bucketID).Take(&bucketAfterRestore).Error; err != nil {
		t.Fatalf("read bucket after restore: %v", err)
	}
	if bucketAfterRestore.UsedBytes != 100 {
		t.Errorf("bucket UsedBytes after restore: got %d want 100 (re-credited)", bucketAfterRestore.UsedBytes)
	}
	if bucketAfterRestore.ObjectCount != 1 {
		t.Errorf("bucket ObjectCount after restore: got %d want 1", bucketAfterRestore.ObjectCount)
	}

	// --- Step 6: PATCH visibility public → private (tightening).
	// The handler should bump capability_version in oss_meta.
	rec = httptest.NewRecorder()
	req = withSubject(httptest.NewRequest(http.MethodPatch,
		"/sub-oss/file?key="+key, stringReader(`{"visibility":"private"}`)), owner)
	req.Header.Set("Content-Type", "application/json")
	server.handleFilePatch(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH public→private: got %d body=%s", rec.Code, rec.Body.String())
	}
	if v := rec.Header().Get("X-Capability-Version"); v == "" {
		t.Errorf("tightening PATCH should expose X-Capability-Version, got empty")
	}

	var capVer ossmodel.Meta
	if err := db.Where("`key` = ?", ossmodel.MetaKeyCapabilityVersion).Take(&capVer).Error; err != nil {
		t.Errorf("capability_version meta row should exist after tightening: %v", err)
	}
	if capVer.Value == "" {
		t.Errorf("capability_version meta value should be non-empty post-tighten")
	}

	// --- Step 7: ListMyFiles — should see the live, private row.
	rec = httptest.NewRecorder()
	req = withSubject(httptest.NewRequest(http.MethodGet,
		"/sub-oss/my-files", nil), owner)
	server.handleListMyFiles(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("LIST: got %d body=%s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Files []map[string]any `json:"files"`
		Total int64            `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list: %v (raw=%s)", err, rec.Body.String())
	}
	if listResp.Total != 1 {
		t.Errorf("LIST total: got %d want 1", listResp.Total)
	}
	if len(listResp.Files) != 1 {
		t.Fatalf("LIST files: got %d want 1", len(listResp.Files))
	}
	if listResp.Files[0]["visibility"] != "private" {
		t.Errorf("LIST visibility: got %v want private", listResp.Files[0]["visibility"])
	}
}

// ---------------------------------------------------------------------------
// Cross-actor isolation
//
// Bob must not be able to act on Alice's row regardless of the
// endpoint. We exercise DELETE + PATCH + RESTORE so a regression
// in any one path surfaces immediately.
// ---------------------------------------------------------------------------

func TestIntegration_CrossActor_OperationsForbidden(t *testing.T) {
	db := initOSSIntegStore(t)
	resetOSSInteg(t, db)

	server := newIntegrationServer(t)
	alice, bob := "did:test:alice", "did:test:bob"
	bucketID := seedBucket(t, db, alice)
	key, fileID := seedFile(t, db, alice, bucketID, "cas/aa/cross", 50, "chat")

	cases := []struct {
		name   string
		method string
		path   string
		body   string
		call   func(*ossSubServer, http.ResponseWriter, *http.Request)
	}{
		{name: "delete", method: http.MethodDelete, path: "/sub-oss/file?key=" + key,
			call: (*ossSubServer).handleFileDelete},
		{name: "patch", method: http.MethodPatch, path: "/sub-oss/file?key=" + key,
			body: `{"visibility":"public"}`,
			call: (*ossSubServer).handleFilePatch},
		{name: "restore", method: http.MethodPost, path: "/sub-oss/file/restore?key=" + key,
			call: (*ossSubServer).handleFileRestore},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			var body io.Reader
			if tc.body != "" {
				body = stringReader(tc.body)
			}
			req := withSubject(httptest.NewRequest(tc.method, tc.path, body), bob)
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			tc.call(server, rec, req)
			if rec.Code == http.StatusOK {
				t.Errorf("%s as bob on alice's row should NOT succeed (got 200, body=%s)",
					tc.name, rec.Body.String())
			}
		})
	}

	// Belt-and-braces: alice's row is unchanged after every bob attempt.
	var afterAttempts ossmodel.FileMeta
	if err := db.Where("id = ?", fileID).Take(&afterAttempts).Error; err != nil {
		t.Fatalf("read alice file after cross-actor attempts: %v", err)
	}
	if afterAttempts.OwnerPTID != alice {
		t.Errorf("owner mutated by bob: got %q", afterAttempts.OwnerPTID)
	}
	if afterAttempts.Visibility != "chat" {
		t.Errorf("visibility mutated by bob: got %q", afterAttempts.Visibility)
	}
	if afterAttempts.DeletedAt != nil {
		t.Errorf("alice's row was deleted by bob")
	}
}

// ---------------------------------------------------------------------------
// MyFiles filters round-trip
//
// Seed two files (different buckets, different visibilities) and
// confirm the filter knobs surface the expected subset. This is
// the only place the bucket+visibility filter combination is
// exercised end-to-end through the real repo's WHERE clauses.
// ---------------------------------------------------------------------------

func TestIntegration_MyFiles_FiltersAndPagination(t *testing.T) {
	db := initOSSIntegStore(t)
	resetOSSInteg(t, db)

	server := newIntegrationServer(t)
	owner := "did:test:carol"
	bucketID := seedBucket(t, db, owner)

	// 3 chat files + 2 private files = 5 total.
	for i := 0; i < 3; i++ {
		seedFile(t, db, owner, bucketID, "cas/c/chat-"+itoa(i), 10, "chat")
	}
	for i := 0; i < 2; i++ {
		seedFile(t, db, owner, bucketID, "cas/c/priv-"+itoa(i), 10, "private")
	}

	type listResp struct {
		Files []map[string]any `json:"files"`
		Total int64            `json:"total"`
	}

	get := func(path string) listResp {
		rec := httptest.NewRecorder()
		req := withSubject(httptest.NewRequest(http.MethodGet, path, nil), owner)
		server.handleListMyFiles(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d body=%s", path, rec.Code, rec.Body.String())
		}
		var got listResp
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode %s: %v", path, err)
		}
		return got
	}

	if got := get("/sub-oss/my-files"); got.Total != 5 {
		t.Errorf("no filter: total=%d want 5", got.Total)
	}
	if got := get("/sub-oss/my-files?visibility=chat"); got.Total != 3 {
		t.Errorf("visibility=chat: total=%d want 3", got.Total)
	}
	if got := get("/sub-oss/my-files?visibility=private"); got.Total != 2 {
		t.Errorf("visibility=private: total=%d want 2", got.Total)
	}
	if got := get("/sub-oss/my-files?page=1&page_size=2"); got.Total != 5 || len(got.Files) != 2 {
		t.Errorf("pagination: total=%d files=%d want total=5 files=2", got.Total, len(got.Files))
	}
	// The bucket filter is by name (matches the system bucket
	// name "chat") — this is the live row count.
	if got := get("/sub-oss/my-files?bucket=chat"); got.Total != 5 {
		t.Errorf("bucket=chat: total=%d want 5", got.Total)
	}
	// Unknown bucket name must NOT silently match every row.
	if got := get("/sub-oss/my-files?bucket=does-not-exist"); got.Total != 0 {
		t.Errorf("unknown bucket: total=%d want 0", got.Total)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// stringReader is the smallest possible io.Reader over a string.
// We avoid `strings.Reader` only to keep the integration tests
// self-contained and free of additional imports.
type strReader struct {
	s string
	i int
}

func (r *strReader) Read(p []byte) (int, error) {
	if r.i >= len(r.s) {
		return 0, io.EOF
	}
	n := copy(p, r.s[r.i:])
	r.i += n
	return n, nil
}
func stringReader(s string) io.Reader { return &strReader{s: s} }

// itoa avoids dragging in `strconv` for a single test-only int->str
// conversion. Sufficient for tiny non-negative loop indices.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	digits := []byte{}
	for i > 0 {
		digits = append([]byte{byte('0' + i%10)}, digits...)
		i /= 10
	}
	return string(digits)
}

// guard against compile drift if auth.WithSubject changes signature.
var _ = auth.WithSubject
