package oss

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	// Version 2 introduced the presigned upload capability fields. Older
	// clients that only check `version >= 1` still work because they
	// ignore unknown fields; newer clients gate their behaviour on
	// `version >= 2 && presigned_upload`.
	if got["version"].(float64) != 2 {
		t.Errorf("version = %v, want 2", got["version"])
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
