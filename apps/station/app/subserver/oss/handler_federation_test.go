package oss

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// stubFileRepo is the in-memory FileRepository used to drive
// `lookupFileMeta` during federation handler tests. We only
// implement the two read paths the handler actually calls
// (`FindByOwnerKey` and `FindByKey`); the rest return nil/zero so
// the interface compiles.
//
// `byOwnerKey` is keyed by owner|key; `byKey` is keyed by key
// alone and serves the public-fallback branch in `lookupFileMeta`.
type stubFileRepo struct {
	byOwnerKey map[string]*ossmodel.FileMeta
	byKey      map[string]*ossmodel.FileMeta
}

func newStubFileRepo() *stubFileRepo {
	return &stubFileRepo{
		byOwnerKey: map[string]*ossmodel.FileMeta{},
		byKey:      map[string]*ossmodel.FileMeta{},
	}
}

func (s *stubFileRepo) put(meta *ossmodel.FileMeta) {
	s.byOwnerKey[meta.OwnerActorID+"|"+meta.Key] = meta
	if _, ok := s.byKey[meta.Key]; !ok {
		s.byKey[meta.Key] = meta
	}
}

func (s *stubFileRepo) Create(_ context.Context, _ *ossmodel.FileMeta) error { return nil }
func (s *stubFileRepo) FindByKey(_ context.Context, key string) (*ossmodel.FileMeta, error) {
	if m, ok := s.byKey[key]; ok {
		return m, nil
	}
	return nil, nil
}
func (s *stubFileRepo) FindByOwnerKey(_ context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	if m, ok := s.byOwnerKey[owner+"|"+key]; ok {
		return m, nil
	}
	return nil, nil
}
func (s *stubFileRepo) FindByOwnerKeyIncludeDeleted(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	return s.FindByOwnerKey(ctx, owner, key)
}
func (s *stubFileRepo) Restore(context.Context, string, time.Time, *time.Time) error { return nil }
func (s *stubFileRepo) MarkDeleted(context.Context, string, time.Time) error          { return nil }
func (s *stubFileRepo) Patch(context.Context, string, ossrepo.FilePatch, time.Time) error {
	return nil
}
func (s *stubFileRepo) ListByOwner(context.Context, string, ossrepo.ListByOwnerFilter, int, int) ([]ossmodel.FileMeta, int64, error) {
	return nil, 0, nil
}

// stubAuditRepo collects appends so federation tests can assert
// the audit row shape. Read paths return zero — federation does
// not exercise them.
type stubAuditRepo struct {
	appended []ossmodel.Audit
}

func (s *stubAuditRepo) Append(_ context.Context, evt ossmodel.Audit) error {
	s.appended = append(s.appended, evt)
	return nil
}
func (s *stubAuditRepo) Query(context.Context, ossrepo.AuditQuery) ([]ossmodel.Audit, int64, error) {
	return nil, 0, nil
}
func (s *stubAuditRepo) Trim(context.Context, time.Time) (int64, error) { return 0, nil }

// newFederationHandlerServer wires the minimum surface
// `handleFederationToken` actually reaches: auth, file lookup,
// audit append, and the federation key cache (via fakePeerKeyRepo
// from federation_test.go).
func newFederationHandlerServer(files *stubFileRepo, audits *stubAuditRepo) *ossSubServer {
	repoFed := newFakePeerKeyRepo()
	return &ossSubServer{
		pathBase:       "/sub-oss",
		authProvider:   stubAuthProvider{},
		fileRepo:       files,
		auditRepo:      audits,
		fedKeys:        newFederationKeyCache(repoFed),
		localStationID: "station-A",
	}
}

// TestHandleFederationToken_RequiresAuth pins the contract that
// the mint endpoint refuses unauthenticated callers — it must
// not advertise a JWT for an actor we cannot verify is who they
// claim to be.
func TestHandleFederationToken_RequiresAuth(t *testing.T) {
	s := newFederationHandlerServer(newStubFileRepo(), &stubAuditRepo{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token",
		bytes.NewBufferString(`{"target_origin":"https://b.example","oss_key":"cas/aa/abc"}`))
	s.handleFederationToken(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != federationReasonAuthRequired {
		t.Fatalf("code = %q, want %q", code, federationReasonAuthRequired)
	}
}

// TestHandleFederationToken_RejectsEmptyBody ensures we 400 on
// missing body rather than fall through to a confusing default.
func TestHandleFederationToken_RejectsEmptyBody(t *testing.T) {
	s := newFederationHandlerServer(newStubFileRepo(), &stubAuditRepo{})

	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token", nil), "did:test:alice")
	s.handleFederationToken(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// TestHandleFederationToken_RejectsMissingFields covers each of
// the two required fields (`target_origin`, `oss_key`) and the
// "non-http(s) scheme" reject path.
func TestHandleFederationToken_RejectsMissingFields(t *testing.T) {
	s := newFederationHandlerServer(newStubFileRepo(), &stubAuditRepo{})

	cases := []struct {
		name string
		body string
	}{
		{name: "missing_origin", body: `{"oss_key":"cas/aa/abc"}`},
		{name: "missing_key", body: `{"target_origin":"https://b.example"}`},
		{name: "non_http_scheme", body: `{"target_origin":"ftp://b.example","oss_key":"cas/aa/abc"}`},
		{name: "garbage_url", body: `{"target_origin":"::","oss_key":"cas/aa/abc"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token",
				bytes.NewBufferString(tc.body)), "did:test:alice")
			s.handleFederationToken(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			code, _ := decodeError(t, rec.Body.Bytes())
			if code != federationReasonBadRequest {
				t.Fatalf("code = %q, want %q", code, federationReasonBadRequest)
			}
		})
	}
}

// TestHandleFederationToken_NotFound asserts a missing FileMeta
// row produces a 404 (not a 500) and an audit row stamped with
// `not_found`.
func TestHandleFederationToken_NotFound(t *testing.T) {
	audits := &stubAuditRepo{}
	s := newFederationHandlerServer(newStubFileRepo(), audits)

	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token",
		bytes.NewBufferString(`{"target_origin":"https://b.example","oss_key":"cas/aa/missing"}`)), "did:test:alice")
	s.handleFederationToken(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if len(audits.appended) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(audits.appended))
	}
	got := audits.appended[0]
	if got.Action != ossmodel.AuditActionFederationMint {
		t.Errorf("action = %q, want %q", got.Action, ossmodel.AuditActionFederationMint)
	}
	if got.Outcome != ossmodel.AuditOutcomeDenied || got.Reason != federationReasonNotFound {
		t.Errorf("outcome=%q reason=%q, want denied/%s", got.Outcome, got.Reason, federationReasonNotFound)
	}
}

// TestHandleFederationToken_ForbiddenByVisibility runs the
// permission gate — a private file owned by Bob cannot be minted
// for by Alice. We assert the audit row reports `not_owner`,
// surfaced through `mapPermissionReason`.
func TestHandleFederationToken_ForbiddenByVisibility(t *testing.T) {
	files := newStubFileRepo()
	files.put(&ossmodel.FileMeta{
		ID:           "f-1",
		OwnerActorID: "did:test:bob",
		Key:          "cas/aa/bobs-private",
		Visibility:   ossmodel.VisibilityPrivate,
		BucketID:     "bucket-1",
		Size:         42,
	})
	audits := &stubAuditRepo{}
	s := newFederationHandlerServer(files, audits)

	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token",
		bytes.NewBufferString(`{"target_origin":"https://b.example","oss_key":"cas/aa/bobs-private"}`)), "did:test:alice")
	s.handleFederationToken(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if len(audits.appended) != 1 {
		t.Fatalf("audit rows = %d", len(audits.appended))
	}
	got := audits.appended[0]
	if got.Reason != federationReasonNotOwner {
		t.Errorf("reason = %q, want %q", got.Reason, federationReasonNotOwner)
	}
	if got.FileID != "f-1" || got.SizeBytes != 42 {
		t.Errorf("file_id/size mismatch: %+v", got)
	}
}

// TestHandleFederationToken_HappyPath_PublicFile is the end-to-end
// success: the actor's own public file mints a token, response
// carries token+kid+expires_at+peer_station_id, and the audit row
// records `outcome=ok`.
func TestHandleFederationToken_HappyPath_PublicFile(t *testing.T) {
	files := newStubFileRepo()
	files.put(&ossmodel.FileMeta{
		ID:           "f-2",
		OwnerActorID: "did:test:alice",
		Key:          "cas/aa/alices-public",
		Visibility:   ossmodel.VisibilityPublic,
		BucketID:     "bucket-1",
		Size:         128,
	})
	audits := &stubAuditRepo{}
	s := newFederationHandlerServer(files, audits)

	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token",
		bytes.NewBufferString(`{"target_origin":"https://b.example","oss_key":"cas/aa/alices-public","ttl_seconds":30}`)), "did:test:alice")
	s.handleFederationToken(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var got federationMintResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Token == "" || !strings.Contains(got.Token, ".") {
		t.Errorf("token missing or not JWS-shaped: %q", got.Token)
	}
	if got.KID == "" {
		t.Errorf("kid is empty")
	}
	if got.PeerStationID == "" {
		t.Errorf("peer_station_id is empty")
	}
	if got.ExpiresAt < time.Now().Unix() || got.ExpiresAt > time.Now().Add(2*federationMaxTTL).Unix() {
		t.Errorf("expires_at out of expected window: %d", got.ExpiresAt)
	}
	// Hash is stable under trailing-slash normalisation.
	if got.PeerStationID != hashOrigin("https://b.example/") {
		t.Errorf("peer_station_id hash drifted from trailing-slash form")
	}

	if len(audits.appended) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(audits.appended))
	}
	aud := audits.appended[0]
	if aud.Outcome != ossmodel.AuditOutcomeOK {
		t.Errorf("outcome = %q, want ok", aud.Outcome)
	}
	if aud.Reason != federationReasonUserOK {
		t.Errorf("reason = %q, want %q", aud.Reason, federationReasonUserOK)
	}
	if aud.PeerStationID == "" {
		t.Errorf("audit missing peer_station_id")
	}
	if aud.ActorID != "did:test:alice" {
		t.Errorf("audit actor_id = %q, want did:test:alice", aud.ActorID)
	}
}

// TestHandleFederationToken_DisabledWhenNoKeyCache covers the
// 501-degraded path: an OSS subserver compiled in (perhaps in
// test mode) without a federation key cache must advertise the
// failure cleanly so the desktop client can fall back to direct
// fetching, not 500.
func TestHandleFederationToken_DisabledWhenNoKeyCache(t *testing.T) {
	s := newFederationHandlerServer(newStubFileRepo(), &stubAuditRepo{})
	s.fedKeys = nil

	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/federation/token",
		bytes.NewBufferString(`{"target_origin":"https://b.example","oss_key":"cas/aa/abc"}`)), "did:test:alice")
	s.handleFederationToken(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != federationReasonUnsupported {
		t.Fatalf("code = %q, want %q", code, federationReasonUnsupported)
	}
}

// TestHashOrigin_TrailingSlashIdempotent guards the audience hash
// against the most common mistake — a missing/extra trailing
// slash producing two different peer ids.
func TestHashOrigin_TrailingSlashIdempotent(t *testing.T) {
	a := hashOrigin("https://example.com")
	b := hashOrigin("https://example.com/")
	if a != b {
		t.Fatalf("hashOrigin not slash-idempotent: %q vs %q", a, b)
	}
	c := hashOrigin("https://example.com/extra")
	if c == a {
		t.Fatalf("hashOrigin collapsed path-bearing origin")
	}
}

// TestValidTargetOrigin documents the accepted/rejected URL
// shapes for the `target_origin` query parameter.
func TestValidTargetOrigin(t *testing.T) {
	good := []string{"http://example.com", "https://example.com", "https://example.com:8080/sub-oss"}
	for _, s := range good {
		if !validTargetOrigin(s) {
			t.Errorf("validTargetOrigin(%q) = false, want true", s)
		}
	}
	bad := []string{"", "::", "ftp://example.com", "javascript:alert(1)", "/relative/path"}
	for _, s := range bad {
		if validTargetOrigin(s) {
			t.Errorf("validTargetOrigin(%q) = true, want false", s)
		}
	}
}

// quick errors.Is to keep the linter happy on the imported package.
var _ = errors.Is
