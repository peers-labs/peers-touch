package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// helper: write a fixture blob under `key` and return the bytes for
// equality checks.
func writeFixture(t *testing.T, b *LocalBackend, key string, body []byte) {
	t.Helper()
	if _, err := b.Save(context.Background(), key, bytes.NewReader(body)); err != nil {
		t.Fatalf("Save: %v", err)
	}
}

// TestLocal_Open_FullBody — nil range returns the entire object.
func TestLocal_Open_FullBody(t *testing.T) {
	b := NewLocalBackend(t.TempDir())
	body := []byte("hello world full body")
	writeFixture(t, b, "fb.txt", body)

	rc, total, mt, err := b.Open(context.Background(), "fb.txt", nil)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body mismatch: got %q want %q", got, body)
	}
	if total != int64(len(body)) {
		t.Fatalf("total = %d, want %d", total, len(body))
	}
	if !strings.HasPrefix(mt, "text/") && mt != "" {
		t.Errorf("expected text-ish mime, got %q", mt)
	}
}

// TestLocal_Open_RangeServesPartial — an inclusive range returns
// only the requested slice and the int64 still reports the full
// object size so callers can build Content-Range headers.
func TestLocal_Open_RangeServesPartial(t *testing.T) {
	b := NewLocalBackend(t.TempDir())
	body := []byte("0123456789")
	writeFixture(t, b, "r.bin", body)

	rng := &Range{Start: 2, End: 5}
	rc, total, _, err := b.Open(context.Background(), "r.bin", rng)
	if err != nil {
		t.Fatalf("Open(range): %v", err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if string(got) != "2345" {
		t.Fatalf("partial body = %q, want %q", got, "2345")
	}
	if total != int64(len(body)) {
		t.Fatalf("total = %d, want %d (full size)", total, len(body))
	}
}

// TestLocal_Open_RangeOpenEnd — End == -1 means "to EOF". The driver
// MUST not try to seek past the end.
func TestLocal_Open_RangeOpenEnd(t *testing.T) {
	b := NewLocalBackend(t.TempDir())
	body := []byte("0123456789")
	writeFixture(t, b, "tail.bin", body)

	rng := &Range{Start: 7, End: -1}
	rc, total, _, err := b.Open(context.Background(), "tail.bin", rng)
	if err != nil {
		t.Fatalf("Open(open-end range): %v", err)
	}
	defer rc.Close()
	got, _ := io.ReadAll(rc)
	if string(got) != "789" {
		t.Fatalf("tail = %q, want %q", got, "789")
	}
	if total != int64(len(body)) {
		t.Fatalf("total = %d, want %d", total, len(body))
	}
}

// TestLocal_Open_RangeNotSatisfiable — start past EOF must surface
// the sentinel error so the OSS handler can map to HTTP 416 without
// leaking the underlying file system error.
func TestLocal_Open_RangeNotSatisfiable(t *testing.T) {
	b := NewLocalBackend(t.TempDir())
	writeFixture(t, b, "small.bin", []byte("abc"))

	cases := []struct {
		name string
		rng  Range
	}{
		{name: "start_past_eof", rng: Range{Start: 100, End: 200}},
		{name: "negative_start", rng: Range{Start: -1, End: 1}},
		{name: "end_before_start", rng: Range{Start: 2, End: 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, _, err := b.Open(context.Background(), "small.bin", &tc.rng)
			if !errors.Is(err, ErrRangeNotSatisfiable) {
				t.Fatalf("err = %v, want ErrRangeNotSatisfiable", err)
			}
		})
	}
}

// TestLocal_Stat_ReturnsSizeAndMime — Stat is the cheap-metadata
// path used by the dashboard inspector and the upload-complete
// HEAD-after-PUT validation.
func TestLocal_Stat_ReturnsSizeAndMime(t *testing.T) {
	b := NewLocalBackend(t.TempDir())
	body := []byte("hello stat")
	writeFixture(t, b, "stat.txt", body)

	st, err := b.Stat(context.Background(), "stat.txt")
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if st.Size != int64(len(body)) {
		t.Errorf("size = %d, want %d", st.Size, len(body))
	}
	if !strings.HasPrefix(st.Mime, "text/") {
		t.Errorf("mime = %q, want text/*", st.Mime)
	}
	if st.ETag == "" {
		t.Error("ETag should be non-empty (synthetic mtime-size)")
	}
}

// TestLocal_Healthz_OkAndMissingRoot — Healthz passes when the root
// exists; failure is fatal once the directory is gone.
func TestLocal_Healthz_OkAndMissingRoot(t *testing.T) {
	root := t.TempDir()
	b := NewLocalBackend(root)
	if err := b.Healthz(context.Background()); err != nil {
		t.Fatalf("healthz on existing root: %v", err)
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatalf("remove root: %v", err)
	}
	if err := b.Healthz(context.Background()); err == nil {
		t.Fatal("expected healthz failure after root removal")
	}
}

// TestLocal_SetExpiry_WritesAndClearsSidecar — the sidecar is the
// observational marker the TTL sweeper drops; SetExpiry(nil) clears
// it so a Restore can wipe the breadcrumb without restating the
// time. We assert the sidecar contents are RFC3339Nano so an
// operator reading the FS by hand can interpret them.
func TestLocal_SetExpiry_WritesAndClearsSidecar(t *testing.T) {
	root := t.TempDir()
	b := NewLocalBackend(root)
	writeFixture(t, b, "exp/blob.bin", []byte("expiring"))

	expiry := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	if err := b.SetExpiry(context.Background(), "exp/blob.bin", &expiry); err != nil {
		t.Fatalf("SetExpiry: %v", err)
	}
	sidecar := filepath.Join(root, "exp/blob.bin"+lifecycleSidecarSuffix)
	body, err := os.ReadFile(sidecar)
	if err != nil {
		t.Fatalf("read sidecar: %v", err)
	}
	got, err := time.Parse(time.RFC3339Nano, string(body))
	if err != nil {
		t.Fatalf("parse sidecar timestamp %q: %v", body, err)
	}
	if !got.Equal(expiry) {
		t.Fatalf("sidecar timestamp = %v, want %v", got, expiry)
	}

	if err := b.SetExpiry(context.Background(), "exp/blob.bin", nil); err != nil {
		t.Fatalf("SetExpiry(clear): %v", err)
	}
	if _, err := os.Stat(sidecar); !os.IsNotExist(err) {
		t.Fatalf("sidecar should be gone, stat err=%v", err)
	}
}

// TestLocal_Delete_AlsoRemovesSidecar — physically deleting an
// object removes its lifecycle sidecar too. This keeps the FS clean
// when the BlobGC worker walks ref_count=0 rows and drops them.
func TestLocal_Delete_AlsoRemovesSidecar(t *testing.T) {
	root := t.TempDir()
	b := NewLocalBackend(root)
	writeFixture(t, b, "gone.bin", []byte("bye"))
	expiry := time.Now().Add(time.Hour)
	if err := b.SetExpiry(context.Background(), "gone.bin", &expiry); err != nil {
		t.Fatalf("SetExpiry: %v", err)
	}

	if err := b.Delete(context.Background(), "gone.bin"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "gone.bin"+lifecycleSidecarSuffix)); !os.IsNotExist(err) {
		t.Fatalf("sidecar should be gone, stat err=%v", err)
	}
}

// TestLocal_Delete_MissingKeyIsIdempotent — calling Delete twice
// must not error, mirroring S3 / lifecycle-worker retry semantics.
func TestLocal_Delete_MissingKeyIsIdempotent(t *testing.T) {
	b := NewLocalBackend(t.TempDir())
	if err := b.Delete(context.Background(), "never-existed.bin"); err != nil {
		t.Fatalf("first delete on missing key: %v", err)
	}
}

// TestLocal_LifecycleBackend_Implements — type assertion guard. If
// somebody decouples LocalBackend from LifecycleBackend by accident
// the dashboard's "schedule TTL" hint silently breaks; pinning the
// implements-check in a unit test catches that at build time.
func TestLocal_LifecycleBackend_Implements(t *testing.T) {
	var _ LifecycleBackend = (*LocalBackend)(nil)
}
