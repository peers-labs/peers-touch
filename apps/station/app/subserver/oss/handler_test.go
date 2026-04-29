package oss

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

// stubPresignBackend is a `storage.Backend` + `storage.PresignedBackend`
// double used by capability tests to flip `presigned_upload` on
// without spinning up a real S3-protocol server.
type stubPresignBackend struct{}

func (stubPresignBackend) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (stubPresignBackend) Open(context.Context, string, *storage.Range) (io.ReadCloser, int64, string, error) {
	return nil, 0, "", nil
}
func (stubPresignBackend) Stat(context.Context, string) (*storage.StatInfo, error) {
	return &storage.StatInfo{}, nil
}
func (stubPresignBackend) Healthz(context.Context) error        { return nil }
func (stubPresignBackend) Delete(context.Context, string) error { return nil }
func (stubPresignBackend) PresignPut(context.Context, string, string, int64, string, time.Duration) (storage.PresignedRequest, error) {
	return storage.PresignedRequest{}, nil
}
func (stubPresignBackend) PresignGet(context.Context, string, time.Duration) (storage.PresignedRequest, error) {
	return storage.PresignedRequest{}, nil
}
func (stubPresignBackend) HeadObject(context.Context, string) (storage.HeadInfo, error) {
	return storage.HeadInfo{}, nil
}

// TestResolveOriginAndBuildCID exercises the federation-critical decision
// of how an OSS subserver advertises its externally-reachable origin and
// embeds it into the `cid` URIs returned to clients. We assert the three
// resolution sources documented on `resolveOrigin`:
//   - explicit `HostOverride`
//   - inbound request scheme + host
//   - `"self"` sentinel when no host info is available
func TestResolveOriginAndBuildCID(t *testing.T) {
	cases := []struct {
		name         string
		hostOverride string
		host         string
		fwdProto     string
		tls          bool
		want         string
	}{
		{name: "host_override_wins", hostOverride: "https://files.example.com", host: "internal:8080", want: "https://files.example.com"},
		{name: "request_host_http", host: "station.local:9090", want: "http://station.local:9090"},
		{name: "request_host_via_fwd_proto", host: "edge.example.com", fwdProto: "https", want: "https://edge.example.com"},
		{name: "tls_implies_https", host: "tls.example.com", tls: true, want: "https://tls.example.com"},
		{name: "no_info_falls_back_to_self", want: "self"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &ossSubServer{hostOverride: strings.TrimRight(tc.hostOverride, "/")}
			var r *http.Request
			if tc.host != "" {
				r = httptest.NewRequest(http.MethodGet, "/", nil)
				r.Host = tc.host
				if tc.fwdProto != "" {
					r.Header.Set("X-Forwarded-Proto", tc.fwdProto)
				}
				if tc.tls {
					// Stand-in for a populated `r.TLS` field. The
					// real tls.ConnectionState is not exported via
					// httptest, so we rely on the X-Forwarded-Proto
					// branch to model TLS-terminating proxies.
					r.Header.Set("X-Forwarded-Proto", "https")
				}
			}
			if got := s.resolveOrigin(r); got != tc.want {
				t.Fatalf("resolveOrigin = %q, want %q", got, tc.want)
			}
			if r != nil {
				cid := s.buildCID(r, "2026/04/26/abc.png")
				wantCID := "oss://" + tc.want + "/2026/04/26/abc.png"
				if cid != wantCID {
					t.Fatalf("buildCID = %q, want %q", cid, wantCID)
				}
			}
		})
	}
}

// TestHandleCapabilitiesShape locks in the wire shape of the public
// `/capabilities` response. Clients (Desktop, future federated peers)
// rely on these field names; bumping any of them is a breaking change
// that must be paired with a `version` increment.
func TestHandleCapabilitiesShape(t *testing.T) {
	s := &ossSubServer{
		pathBase:           "/sub-oss",
		hostOverride:       "https://example.com",
		signSecret:         "secret",
		backendType:        "local",
		keyStrategy:        "cas",
		maxFileSize:        16 << 20,
		maxFilesPerMessage: 5,
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/capabilities", nil)
	s.handleCapabilities(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	wantKeys := []string{
		"version", "host", "path_base", "backend", "key_strategy",
		"max_file_size", "max_files_per_message",
		"signed_url", "upload_endpoint", "file_endpoint", "meta_endpoint",
		"presigned_upload",
	}
	for _, k := range wantKeys {
		if _, ok := got[k]; !ok {
			t.Errorf("missing capability key %q", k)
		}
	}
	if got["host"] != "https://example.com" {
		t.Errorf("host = %v, want override", got["host"])
	}
	if got["signed_url"] != true {
		t.Errorf("signed_url = %v, want true (signSecret set)", got["signed_url"])
	}
	// Version 3 added object lifecycle (`lifecycle_endpoints`) and
	// outbound federation (`federation`) on top of v2's presigned
	// fields. Older clients that only check `version >= 1` still
	// work because they ignore unknown fields; newer clients gate
	// their behaviour on `version >= 3` for the lifecycle path.
	if got["version"].(float64) != 3 {
		t.Errorf("version = %v, want 3", got["version"])
	}
	// v3 surfaces `lifecycle_endpoints` unconditionally — clients
	// rely on its presence to decide whether DELETE/PATCH/restore
	// are supported on this station.
	if _, ok := got["lifecycle_endpoints"]; !ok {
		t.Errorf("missing v3 key %q", "lifecycle_endpoints")
	}
	// `federation` is also unconditional, but its `outbound` flag
	// is false here because no fedCache / localStationID is wired.
	fed, ok := got["federation"].(map[string]any)
	if !ok {
		t.Fatalf("federation key missing or wrong type: %v", got["federation"])
	}
	if fed["outbound"] != false {
		t.Errorf("federation.outbound = %v, want false (no fedCache)", fed["outbound"])
	}
	if fed["mint_endpoint"] != "/sub-oss/federation/token" {
		t.Errorf("federation.mint_endpoint = %v", fed["mint_endpoint"])
	}
	if got["key_strategy"] != "cas" {
		t.Errorf("key_strategy = %v, want cas", got["key_strategy"])
	}
	// Without a presigned-capable backend, `presigned_upload` is false
	// and the endpoint map is omitted from the response.
	if got["presigned_upload"] != false {
		t.Errorf("presigned_upload = %v, want false (no PresignedBackend)", got["presigned_upload"])
	}
	if _, ok := got["presigned_endpoints"]; ok {
		t.Error("presigned_endpoints should be omitted when feature is disabled")
	}
}

// TestHandleCapabilities_PresignedFieldsWhenEnabled verifies that the
// presigned upload capability fields appear when the active backend
// implements `PresignedBackend` AND the threshold is non-zero. We
// stub the backend with a fake that satisfies the interface; the
// handler does not actually call into it for `/capabilities`, so the
// fake's methods can return zero values.
func TestHandleCapabilities_PresignedFieldsWhenEnabled(t *testing.T) {
	s := &ossSubServer{
		pathBase:           "/sub-oss",
		hostOverride:       "https://example.com",
		backendType:        "s3",
		keyStrategy:        "cas",
		maxFileSize:        16 << 20,
		maxFilesPerMessage: 5,
		backend:            stubPresignBackend{},
		presignedThreshold: 8 << 20,
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/capabilities", nil)
	s.handleCapabilities(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["presigned_upload"] != true {
		t.Errorf("presigned_upload = %v, want true", got["presigned_upload"])
	}
	if got["presigned_threshold"].(float64) != float64(8<<20) {
		t.Errorf("presigned_threshold = %v, want %d", got["presigned_threshold"], 8<<20)
	}
	endpoints, ok := got["presigned_endpoints"].(map[string]any)
	if !ok {
		t.Fatalf("presigned_endpoints missing or wrong type: %v", got["presigned_endpoints"])
	}
	if endpoints["presign"] != "/sub-oss/presign-upload" {
		t.Errorf("presign endpoint = %v", endpoints["presign"])
	}
	if endpoints["complete"] != "/sub-oss/upload-complete" {
		t.Errorf("complete endpoint = %v", endpoints["complete"])
	}
}

// ---------------------------------------------------------------------
// S4 — Lifecycle (DELETE / restore) handler tests.
//
// The wire contract these tests pin:
//   - 401 + reason=auth_required when no JWT subject.
//   - 400 + reason=bad_request when key is missing.
//   - 403 + reason=not_owner when ?owner=… disagrees with subject.
//   - 404 + reason=not_found, 410 + reason=restore_window_expired,
//     409 + reason=already_live, 413 + reason=quota_exceeded —
//     each maps to a distinct service error.
//   - 200 OK + JSON body on the happy path; idempotent re-DELETE
//     reports `already_deleted=true`.
//
// We stub auth.Provider and FileService to keep these tests purely
// behavioural; full end-to-end is exercised at the service layer
// (file_service_test.go).
// ---------------------------------------------------------------------

// stubAuthProvider is a no-op auth.Provider — the handler only
// checks the field is non-nil and reads the Subject from the
// context (set up by the test).
type stubAuthProvider struct{}

func (stubAuthProvider) Method() auth.Method { return auth.MethodJWT }
func (stubAuthProvider) Authenticate(context.Context, auth.Credentials) (*auth.Subject, *auth.Token, error) {
	return nil, nil, nil
}
func (stubAuthProvider) Validate(context.Context, string) (*auth.Subject, error) {
	return nil, nil
}
func (stubAuthProvider) Revoke(context.Context, string) error { return nil }

// stubFileService implements service.FileService and returns the
// canned (meta, err) triplet for Delete/Restore/Patch. SaveFile et
// al. are never exercised by the lifecycle tests, but we still
// need the interface to be fully satisfied.
type stubFileService struct {
	deleteFn  func(ctx context.Context, owner, key string) (*service.DeleteResult, error)
	restoreFn func(ctx context.Context, owner, key string, grace time.Duration) (*service.RestoreResult, error)
	patchFn   func(ctx context.Context, owner, key string, req service.PatchRequest) (*service.PatchResult, error)
	listFn    func(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error)
}

func (s *stubFileService) SaveFile(context.Context, service.UploadAttribution, multipart.File, *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	return nil, nil
}
func (s *stubFileService) GetFileMeta(context.Context, string) (*ossmodel.FileMeta, error) {
	return nil, nil
}
func (s *stubFileService) PrepareUpload(context.Context, storage.PresignedBackend, service.UploadAttribution, service.PrepareUploadRequest, time.Duration) (service.PrepareUploadResult, error) {
	return service.PrepareUploadResult{}, nil
}
func (s *stubFileService) CompleteUpload(context.Context, storage.PresignedBackend, service.UploadAttribution, service.CompleteUploadRequest) (*ossmodel.FileMeta, error) {
	return nil, nil
}
func (s *stubFileService) DeleteFile(ctx context.Context, owner, key string) (*service.DeleteResult, error) {
	return s.deleteFn(ctx, owner, key)
}
func (s *stubFileService) RestoreFile(ctx context.Context, owner, key string, grace time.Duration) (*service.RestoreResult, error) {
	return s.restoreFn(ctx, owner, key, grace)
}
func (s *stubFileService) PatchFile(ctx context.Context, owner, key string, req service.PatchRequest) (*service.PatchResult, error) {
	if s.patchFn == nil {
		return nil, errors.New("stubFileService.PatchFile not wired")
	}
	return s.patchFn(ctx, owner, key, req)
}
func (s *stubFileService) ListMyFiles(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error) {
	if s.listFn == nil {
		return nil, errors.New("stubFileService.ListMyFiles not wired")
	}
	return s.listFn(ctx, owner, req)
}

func newLifecycleServer(svc service.FileService) *ossSubServer {
	return &ossSubServer{
		pathBase:        "/sub-oss",
		authProvider:    stubAuthProvider{},
		fileService:     svc,
		softDeleteGrace: 7 * 24 * time.Hour,
	}
}

func withSubject(req *http.Request, id string) *http.Request {
	return req.WithContext(auth.WithSubject(req.Context(), &auth.Subject{ID: id}))
}

func decodeError(t *testing.T, body []byte) (code, errMsg string) {
	t.Helper()
	var got map[string]string
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode error body: %v (raw=%q)", err, string(body))
	}
	return got["code"], got["error"]
}

func TestHandleFileDelete_RequiresAuth(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/sub-oss/file?key=cas/aa/abc", nil)
	// Note: no `withSubject` — context has no auth.Subject.

	s.handleFileDelete(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonAuthRequired {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonAuthRequired)
	}
}

func TestHandleFileDelete_RejectsMissingKey(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodDelete, "/sub-oss/file", nil), "did:test:alice")

	s.handleFileDelete(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonBadRequest {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonBadRequest)
	}
}

func TestHandleFileDelete_RejectsCrossActorOwner(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodDelete, "/sub-oss/file?key=cas/aa/abc&owner=did:test:bob", nil), "did:test:alice")

	s.handleFileDelete(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonNotOwner {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonNotOwner)
	}
}

func TestHandleFileDelete_HappyPath(t *testing.T) {
	deletedAt := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	svc := &stubFileService{
		deleteFn: func(ctx context.Context, owner, key string) (*service.DeleteResult, error) {
			return &service.DeleteResult{
				Meta: &ossmodel.FileMeta{
					Key:       key,
					DeletedAt: &deletedAt,
				},
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodDelete, "/sub-oss/file?key=cas/aa/abc", nil), "did:test:alice")

	s.handleFileDelete(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["key"] != "cas/aa/abc" {
		t.Errorf("key = %v, want cas/aa/abc", got["key"])
	}
	if got["already_deleted"] != false {
		t.Errorf("already_deleted = %v, want false", got["already_deleted"])
	}
	if got["deleted_at"] == nil {
		t.Errorf("deleted_at must be present on successful delete")
	}
}

func TestHandleFileDelete_IdempotentReportsAlreadyDeleted(t *testing.T) {
	deletedAt := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	svc := &stubFileService{
		deleteFn: func(ctx context.Context, owner, key string) (*service.DeleteResult, error) {
			return &service.DeleteResult{
				Meta:           &ossmodel.FileMeta{Key: key, DeletedAt: &deletedAt},
				AlreadyDeleted: true,
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodDelete, "/sub-oss/file?key=cas/aa/abc", nil), "did:test:alice")

	s.handleFileDelete(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["already_deleted"] != true {
		t.Fatalf("already_deleted = %v, want true", got["already_deleted"])
	}
}

func TestHandleFileDelete_NotFoundMappedTo404(t *testing.T) {
	svc := &stubFileService{
		deleteFn: func(context.Context, string, string) (*service.DeleteResult, error) {
			return nil, service.ErrFileNotFound
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodDelete, "/sub-oss/file?key=cas/aa/missing", nil), "did:test:alice")

	s.handleFileDelete(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonNotFound {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonNotFound)
	}
}

func TestHandleFileRestore_HappyPath(t *testing.T) {
	expires := time.Date(2026, 5, 4, 0, 0, 0, 0, time.UTC)
	updated := time.Date(2026, 4, 27, 13, 0, 0, 0, time.UTC)
	svc := &stubFileService{
		restoreFn: func(ctx context.Context, owner, key string, grace time.Duration) (*service.RestoreResult, error) {
			return &service.RestoreResult{
				Meta: &ossmodel.FileMeta{
					Key:       key,
					ExpiresAt: &expires,
					UpdatedAt: updated,
				},
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/file/restore?key=cas/aa/abc", nil), "did:test:alice")

	s.handleFileRestore(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["key"] != "cas/aa/abc" {
		t.Errorf("key = %v", got["key"])
	}
	if got["deleted_at"] != nil {
		t.Errorf("deleted_at must be null after restore, got %v", got["deleted_at"])
	}
	if got["expires_at"] == nil {
		t.Errorf("expires_at must be set on restore response")
	}
}

func TestHandleFileRestore_OutsideGraceMappedTo410(t *testing.T) {
	svc := &stubFileService{
		restoreFn: func(context.Context, string, string, time.Duration) (*service.RestoreResult, error) {
			return nil, service.ErrRestoreWindowExpired
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/file/restore?key=cas/aa/abc", nil), "did:test:alice")

	s.handleFileRestore(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonRestoreExpired {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonRestoreExpired)
	}
}

func TestHandleFileRestore_AlreadyLiveMappedTo409(t *testing.T) {
	svc := &stubFileService{
		restoreFn: func(context.Context, string, string, time.Duration) (*service.RestoreResult, error) {
			return nil, service.ErrFileAlreadyLive
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPost, "/sub-oss/file/restore?key=cas/aa/abc", nil), "did:test:alice")

	s.handleFileRestore(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonAlreadyLive {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonAlreadyLive)
	}
}

// ---------------------------------------------------------------------
// S5 — PATCH handler tests.
// ---------------------------------------------------------------------

func TestHandleFilePatch_RequiresAuth(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"filename":"x.txt"}`)
	req := httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", body)

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonAuthRequired {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonAuthRequired)
	}
}

func TestHandleFilePatch_RejectsMissingKey(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"filename":"x.txt"}`)
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file", body), "did:test:alice")

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandleFilePatch_RejectsEmptyBody(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", strings.NewReader("")), "did:test:alice")

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandleFilePatch_HappyPath(t *testing.T) {
	updated := time.Date(2026, 4, 27, 13, 0, 0, 0, time.UTC)
	svc := &stubFileService{
		patchFn: func(ctx context.Context, owner, key string, req service.PatchRequest) (*service.PatchResult, error) {
			if req.Filename == nil || *req.Filename != "renamed.txt" {
				return nil, errors.New("expected filename in request")
			}
			return &service.PatchResult{
				Meta: &ossmodel.FileMeta{
					Key:        key,
					Visibility: ossmodel.VisibilityChat,
					Name:       "renamed.txt",
					UpdatedAt:  updated,
				},
				FieldsChanged: []string{"filename"},
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"filename":"renamed.txt"}`)
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", body), "did:test:alice")

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Capability-Version") != "" {
		t.Errorf("non-tightening patch should not set X-Capability-Version header")
	}
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["filename"] != "renamed.txt" {
		t.Errorf("filename = %v", got["filename"])
	}
	if got["fields_changed"].([]any)[0] != "filename" {
		t.Errorf("fields_changed = %v", got["fields_changed"])
	}
	if _, ok := got["capability_version"]; ok {
		t.Errorf("capability_version must be absent on non-tightening patch")
	}
}

func TestHandleFilePatch_TighteningSetsCapabilityVersionHeader(t *testing.T) {
	svc := &stubFileService{
		patchFn: func(ctx context.Context, owner, key string, req service.PatchRequest) (*service.PatchResult, error) {
			return &service.PatchResult{
				Meta: &ossmodel.FileMeta{
					Key:        key,
					Visibility: ossmodel.VisibilityPrivate,
				},
				FieldsChanged:       []string{"visibility"},
				VisibilityTightened: true,
				CapabilityVersion:   "01HBC0FFEE",
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"visibility":"private"}`)
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", body), "did:test:alice")

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("X-Capability-Version") != "01HBC0FFEE" {
		t.Errorf("X-Capability-Version = %q", rec.Header().Get("X-Capability-Version"))
	}
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["capability_version"] != "01HBC0FFEE" {
		t.Errorf("capability_version = %v, want 01HBC0FFEE", got["capability_version"])
	}
}

func TestHandleFilePatch_InvalidVisibilityMappedTo400(t *testing.T) {
	svc := &stubFileService{
		patchFn: func(context.Context, string, string, service.PatchRequest) (*service.PatchResult, error) {
			return nil, service.ErrInvalidVisibility
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"visibility":"top-secret"}`)
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", body), "did:test:alice")

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonInvalidVisibility {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonInvalidVisibility)
	}
}

func TestHandleFilePatch_PatchOnDeletedMappedTo410(t *testing.T) {
	svc := &stubFileService{
		patchFn: func(context.Context, string, string, service.PatchRequest) (*service.PatchResult, error) {
			return nil, service.ErrPatchOnDeleted
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"filename":"x.txt"}`)
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", body), "did:test:alice")

	s.handleFilePatch(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonPatchOnDeleted {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonPatchOnDeleted)
	}
}

func TestHandleFilePatch_ExpiresAtNullIsClear(t *testing.T) {
	var seenSet bool
	var seenExp *time.Time
	svc := &stubFileService{
		patchFn: func(ctx context.Context, owner, key string, req service.PatchRequest) (*service.PatchResult, error) {
			seenSet = req.ExpiresAtSet
			seenExp = req.ExpiresAt
			return &service.PatchResult{
				Meta:          &ossmodel.FileMeta{Key: key},
				FieldsChanged: []string{"expires_at"},
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"expires_at":null}`)
	req := withSubject(httptest.NewRequest(http.MethodPatch, "/sub-oss/file?key=cas/aa/abc", body), "did:test:alice")

	s.handleFilePatch(rec, req)

	if !seenSet {
		t.Fatal("ExpiresAtSet must be true when client sends expires_at:null")
	}
	if seenExp != nil {
		t.Fatalf("ExpiresAt must be nil when client sends null; got %v", seenExp)
	}
}

// ---------------------------------------------------------------------------
// S6 — handleListMyFiles
// ---------------------------------------------------------------------------

func TestHandleListMyFiles_RequiresAuth(t *testing.T) {
	s := newLifecycleServer(&stubFileService{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub-oss/my-files", nil) // no subject

	s.handleListMyFiles(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonAuthRequired {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonAuthRequired)
	}
}

func TestHandleListMyFiles_HappyPath(t *testing.T) {
	svc := &stubFileService{
		listFn: func(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error) {
			if owner != "did:test:alice" {
				t.Errorf("service got owner=%q, want did:test:alice", owner)
			}
			return &service.ListMyFilesResult{
				Files: []ossmodel.FileMeta{
					{Key: "cas/aa/abc", Name: "abc.png", Size: 100, Mime: "image/png"},
					{Key: "cas/bb/def", Name: "def.jpg", Size: 200, Mime: "image/jpeg"},
				},
				Total:    2,
				Page:     1,
				PageSize: 50,
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodGet, "/sub-oss/my-files", nil), "did:test:alice")

	s.handleListMyFiles(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got struct {
		Files    []map[string]any `json:"files"`
		Total    int64            `json:"total"`
		Page     int              `json:"page"`
		PageSize int              `json:"page_size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v (raw=%q)", err, rec.Body.String())
	}
	if got.Total != 2 || got.Page != 1 || got.PageSize != 50 {
		t.Errorf("envelope = %+v, want total=2 page=1 page_size=50", got)
	}
	if len(got.Files) != 2 || got.Files[0]["key"] != "cas/aa/abc" {
		t.Errorf("files = %+v", got.Files)
	}
}

func TestHandleListMyFiles_PassesAllFilters(t *testing.T) {
	var captured service.ListMyFilesRequest
	svc := &stubFileService{
		listFn: func(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error) {
			captured = req
			return &service.ListMyFilesResult{Page: 2, PageSize: 25}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	url := "/sub-oss/my-files?bucket=personal&visibility=private&mime=image/&include_deleted=true&page=2&page_size=25"
	req := withSubject(httptest.NewRequest(http.MethodGet, url, nil), "did:test:alice")

	s.handleListMyFiles(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%q", rec.Code, rec.Body.String())
	}
	if captured.BucketName != "personal" {
		t.Errorf("bucket = %q, want 'personal'", captured.BucketName)
	}
	if captured.Visibility != "private" {
		t.Errorf("visibility = %q, want 'private'", captured.Visibility)
	}
	if captured.MimePrefix != "image/" {
		t.Errorf("mime = %q, want 'image/'", captured.MimePrefix)
	}
	if !captured.IncludeDeleted {
		t.Errorf("include_deleted = false, want true")
	}
	if captured.Page != 2 || captured.PageSize != 25 {
		t.Errorf("paging = (%d,%d), want (2,25)", captured.Page, captured.PageSize)
	}
}

func TestHandleListMyFiles_RejectsInvalidPaging(t *testing.T) {
	svc := &stubFileService{
		listFn: func(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error) {
			return &service.ListMyFilesResult{}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodGet, "/sub-oss/my-files?page=notnum", nil), "did:test:alice")

	s.handleListMyFiles(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonBadRequest {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonBadRequest)
	}
}

func TestHandleListMyFiles_InvalidVisibilityMappedTo400(t *testing.T) {
	svc := &stubFileService{
		listFn: func(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error) {
			return nil, service.ErrInvalidVisibility
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodGet, "/sub-oss/my-files?visibility=weird", nil), "did:test:alice")

	s.handleListMyFiles(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	code, _ := decodeError(t, rec.Body.Bytes())
	if code != lifecycleReasonInvalidVisibility {
		t.Fatalf("code = %q, want %q", code, lifecycleReasonInvalidVisibility)
	}
}

func TestHandleListMyFiles_EmptyResponseHasFilesArrayNotNull(t *testing.T) {
	svc := &stubFileService{
		listFn: func(ctx context.Context, owner string, req service.ListMyFilesRequest) (*service.ListMyFilesResult, error) {
			return &service.ListMyFilesResult{
				Files:    nil, // service returns nil slice on empty result
				Total:    0,
				Page:     1,
				PageSize: 50,
			}, nil
		},
	}
	s := newLifecycleServer(svc)
	rec := httptest.NewRecorder()
	req := withSubject(httptest.NewRequest(http.MethodGet, "/sub-oss/my-files", nil), "did:test:alice")

	s.handleListMyFiles(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Important contract: `"files": []`, never `"files": null`.
	if !strings.Contains(rec.Body.String(), `"files":[]`) {
		t.Errorf("body must contain `files:[]`, got %q", rec.Body.String())
	}
}
