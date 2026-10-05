// Package storage owns the file plane primitives used by the OSS
// subserver and any other component that needs blob storage. The
// public surface is split across three concerns:
//
//   - `Backend` — the minimal contract every driver implements:
//     `Save`, `Open`, `Delete`. Any driver works as a Backend.
//
//   - Capability interfaces (`PresignedBackend`, …) — opt-in. A
//     driver implements them only when it can provide that semantic
//     natively. Callers feature-detect via type assertion and
//     gracefully fall through when the active driver does not
//     advertise the capability.
//
//   - `Service` — a thin orchestrator over a `Backend`. Used when
//     callers want both bytes and metadata in one round-trip
//     without touching the FileMeta DB layer.
//
// Drivers ship one file each (`local.go`, `s3.go`, …); the factory in
// `factory.go` constructs the right one from `Config`.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"time"
)

// Backend defines the minimum contract every storage driver must
// satisfy. Implementations are expected to be safe for concurrent use.
//
//   - Save streams bytes from `r` into the object identified by `key`
//     and returns the canonical path/URI of the stored object.
//   - Open returns a reader for `key`. When `rng` is nil the reader
//     serves the full body; when non-nil it serves the inclusive
//     byte range `[rng.Start, rng.End]` (HTTP semantics; `rng.End`
//     of `-1` means "to EOF"). The returned int64 is always the
//     **full object size**, not the range length — callers compute
//     Content-Range from the supplied range. The returned string is
//     the object's media type, when the driver knows it.
//   - Stat returns size + mime + ETag without transferring the body.
//     Used by the HEAD-after-presign-upload path and by the dashboard
//     diagnostics endpoints.
//   - Delete removes the object. Idempotent: deleting a missing key
//     returns nil so retries from the lifecycle workers do not spam
//     audit rows.
//   - Healthz performs a lightweight probe of the underlying store
//     (HeadBucket for S3, root-stat for Local). It is wired into
//     `/sub-oss/healthz` by the OSS subserver and MUST return within
//     the caller's context deadline.
type Backend interface {
	Save(ctx context.Context, key string, r io.Reader) (string, error)
	Open(ctx context.Context, key string, rng *Range) (io.ReadCloser, int64, string, error)
	Stat(ctx context.Context, key string) (*StatInfo, error)
	Delete(ctx context.Context, key string) error
	Healthz(ctx context.Context) error
}

// Range describes an inclusive byte range request against a Backend.
//
// `Start` is the first byte to return (0-indexed). `End` is the last
// byte to return, inclusive — matching `Range: bytes=A-B` HTTP
// semantics. `End == -1` means "to EOF" so callers can express the
// `bytes=N-` form without knowing the object size in advance.
//
// Drivers MUST return an error rather than silently clamping when
// `Start` is past EOF; callers translate the error into HTTP 416.
type Range struct {
	Start int64
	End   int64
}

// StatInfo is the metadata triple Backend.Stat returns. It is the
// same shape as PresignedBackend.HeadObject's HeadInfo but pruned
// of presign-specific fields (no SHA-256 hint — that's a property
// of how the upload was issued, not the bytes themselves).
type StatInfo struct {
	Size int64
	Mime string
	ETag string
}

// LifecycleBackend is the optional capability a Backend advertises
// when it can stamp per-object expiry hints near the bytes
// themselves. The TTL sweeper writes the expiry alongside the blob
// so an out-of-band recovery (DB lost / reseeded) can still observe
// "this blob was scheduled to expire at X". The DB row is the
// authoritative source — the sidecar is observational.
//
// `expiresAt == nil` clears the hint.
type LifecycleBackend interface {
	SetExpiry(ctx context.Context, key string, expiresAt *time.Time) error
}

// PresignedRequest describes a short-lived URL the client uses to
// transfer bytes directly to/from the underlying storage, bypassing
// the Station for the bandwidth-heavy step. Only drivers that natively
// support pre-signed URLs (e.g. S3-protocol stores) emit these.
//
// `Method` is `"PUT"` for uploads and `"GET"` for downloads. `Headers`
// is the map of headers the client *must* echo on the underlying
// request — for S3 + CAS this typically carries
// `x-amz-checksum-sha256` so the server-side integrity contract is
// preserved end-to-end. `MaxBytes` is the upload-side cap (zero for
// downloads). `ExpiresAt` is informational; the underlying URL
// signature is what actually enforces expiry.
type PresignedRequest struct {
	Method    string
	URL       string
	Headers   map[string]string
	MaxBytes  int64
	ExpiresAt time.Time
}

// HeadInfo is the metadata triple returned by `HeadObject`. `ETag` is
// the storage-native integrity tag — for S3 single-part uploads this
// is the MD5 hex; for multipart uploads it is the concatenation hash
// followed by `-N`. `Sha256` is populated only when the driver was
// able to return the SHA-256 checksum (S3 returns it on the response
// when `x-amz-checksum-sha256` was bound at upload time).
type HeadInfo struct {
	Size   int64
	Mime   string
	ETag   string
	Sha256 string
}

// PresignedBackend is the optional capability a `Backend` advertises
// when it can issue pre-signed URLs. Callers feature-detect with
// `if p, ok := b.(storage.PresignedBackend); ok { … }`. Drivers that
// do not implement this interface are still fully usable through the
// proxy path; they just cannot offload bandwidth to direct
// client↔storage transfers.
//
// `PresignPut` should bind any integrity expectations the caller
// passes (`sha256Hex`, `contentLength`) into the signature so that a
// client that PUTs different bytes is rejected by the underlying
// store, not just by a follow-up server-side validation.
type PresignedBackend interface {
	PresignPut(ctx context.Context, key, contentType string, contentLength int64, sha256Hex string, ttl time.Duration) (PresignedRequest, error)
	PresignGet(ctx context.Context, key string, ttl time.Duration) (PresignedRequest, error)
	HeadObject(ctx context.Context, key string) (HeadInfo, error)
}

// LocalBackend stores files under a local root directory. It is the
// zero-config default — no external services, no credentials — and
// the right backend for the home-deployment story spelled out in
// `docs/architecture/shared/object-storage.md`.
type LocalBackend struct{ root string }

// NewLocalBackend creates a LocalBackend with the given root.
func NewLocalBackend(root string) *LocalBackend { return &LocalBackend{root: root} }

// Save writes a reader to the given key and returns the full path.
func (b *LocalBackend) Save(ctx context.Context, key string, r io.Reader) (string, error) {
	full := filepath.Join(b.root, key)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", err
	}
	f, err := os.Create(full)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err = io.Copy(f, r); err != nil {
		return "", err
	}
	return full, nil
}

// Open opens the stored item by key and returns reader, size and mime.
//
// When `rng` is non-nil the reader is positioned at `rng.Start` and
// truncated to the requested length (`rng.End` inclusive; `-1`
// expands to EOF). Out-of-range starts return `ErrRangeNotSatisfiable`
// so the caller can map to HTTP 416. The returned size is ALWAYS the
// full file size — callers compute Content-Range and Content-Length
// from `rng` themselves.
func (b *LocalBackend) Open(ctx context.Context, key string, rng *Range) (io.ReadCloser, int64, string, error) {
	full := filepath.Join(b.root, key)
	f, err := os.Open(full)
	if err != nil {
		return nil, 0, "", err
	}
	st, statErr := f.Stat()
	if statErr != nil {
		_ = f.Close()
		return nil, 0, "", statErr
	}
	mt := mime.TypeByExtension(filepath.Ext(full))
	totalSize := st.Size()
	if rng == nil {
		return f, totalSize, mt, nil
	}
	start, end, length, rerr := normaliseRange(*rng, totalSize)
	if rerr != nil {
		_ = f.Close()
		return nil, 0, "", rerr
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		_ = f.Close()
		return nil, 0, "", err
	}
	_ = end // currently used only by S3 driver; kept here for symmetry
	return &limitedFile{File: f, remaining: length}, totalSize, mt, nil
}

// Stat returns size + mime without consuming the body.
func (b *LocalBackend) Stat(ctx context.Context, key string) (*StatInfo, error) {
	full := filepath.Join(b.root, key)
	st, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	return &StatInfo{
		Size: st.Size(),
		Mime: mime.TypeByExtension(filepath.Ext(full)),
		// Local has no native ETag; we surface a synthetic
		// `mtime-size` so the caller can detect "did this object
		// change?" without re-fetching bytes. Format is opaque on
		// purpose — clients should not parse it.
		ETag: localETag(st),
	}, nil
}

// Delete removes the stored item by key. Returns nil for missing
// objects (idempotent semantics; mirrors S3 behaviour). Also clears
// the lifecycle sidecar if one is present.
func (b *LocalBackend) Delete(ctx context.Context, key string) error {
	full := filepath.Join(b.root, key)
	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = os.Remove(full + lifecycleSidecarSuffix)
	return nil
}

// Healthz verifies the configured root directory exists and is
// readable. Cheap enough to call on every probe — a `stat(2)` against
// the root inode.
func (b *LocalBackend) Healthz(ctx context.Context) error {
	if b.root == "" {
		return errors.New("storage.local: root not configured")
	}
	if _, err := os.Stat(b.root); err != nil {
		return fmt.Errorf("storage.local: healthz: %w", err)
	}
	return nil
}

// SetExpiry writes a sidecar file `<key>.expires` containing the
// RFC3339 timestamp. Used by the TTL sweeper to leave an
// observational breadcrumb next to the bytes; the DB row remains the
// authoritative source. `expiresAt == nil` removes the sidecar.
//
// We intentionally do not block Save/Open on sidecar I/O — the upload
// hot path is uninvolved. Worker invocation is the only writer.
func (b *LocalBackend) SetExpiry(ctx context.Context, key string, expiresAt *time.Time) error {
	if b.root == "" {
		return errors.New("storage.local: root not configured")
	}
	sidecar := filepath.Join(b.root, key) + lifecycleSidecarSuffix
	if expiresAt == nil {
		if err := os.Remove(sidecar); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("storage.local: clear sidecar: %w", err)
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(sidecar), 0o755); err != nil {
		return fmt.Errorf("storage.local: sidecar mkdir: %w", err)
	}
	body := []byte(expiresAt.UTC().Format(time.RFC3339Nano))
	if err := os.WriteFile(sidecar, body, 0o644); err != nil {
		return fmt.Errorf("storage.local: write sidecar: %w", err)
	}
	return nil
}

// lifecycleSidecarSuffix is the filename suffix appended to each
// blob to record its expiry. We deliberately avoid a dotfile (e.g.
// `.expires`) so a directory listing surfaces the metadata next to
// the blob — operators reading the FS directly should be able to
// correlate by eye.
const lifecycleSidecarSuffix = ".expires"

// localETag derives an opaque "did it change" tag from a file's
// `mtime` + `size`. Cheap, stable across reads, and good enough for
// the consumers who care (the dashboard's "stale meta?" indicator).
// Not cryptographic — callers MUST NOT use it for integrity.
func localETag(st os.FileInfo) string {
	return fmt.Sprintf("%d-%d", st.ModTime().UnixNano(), st.Size())
}

// normaliseRange validates an inclusive byte range against the
// authoritative file size. Returns the resolved start/end/length
// triple and `ErrRangeNotSatisfiable` when `rng` cannot be served.
// Open paths use the returned length to truncate the reader; the
// `end` is forwarded to drivers (e.g. S3) that take an explicit
// end byte.
func normaliseRange(rng Range, totalSize int64) (start, end, length int64, err error) {
	if totalSize == 0 {
		return 0, 0, 0, ErrRangeNotSatisfiable
	}
	start = rng.Start
	end = rng.End
	if start < 0 || start >= totalSize {
		return 0, 0, 0, ErrRangeNotSatisfiable
	}
	if end < 0 || end >= totalSize {
		end = totalSize - 1
	}
	if end < start {
		return 0, 0, 0, ErrRangeNotSatisfiable
	}
	return start, end, end - start + 1, nil
}

// ErrRangeNotSatisfiable is returned by `Open` when the supplied
// `*Range` is invalid for the addressed object. Handlers map this
// to HTTP 416.
var ErrRangeNotSatisfiable = errors.New("storage: range not satisfiable")

// limitedFile is a `io.ReadCloser` that wraps an `*os.File` and
// stops reading after `remaining` bytes. We cannot use
// `io.LimitReader` directly because we need a `Closer` too; the
// stdlib's `io.NopCloser(io.LimitReader(...))` would discard the
// underlying `Close()` and leak the file handle.
type limitedFile struct {
	*os.File
	remaining int64
}

func (l *limitedFile) Read(p []byte) (int, error) {
	if l.remaining <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > l.remaining {
		p = p[:l.remaining]
	}
	n, err := l.File.Read(p)
	l.remaining -= int64(n)
	return n, err
}

// SaveResult describes a saved item metadata.
type SaveResult struct {
	Key, Path, Mime string
	Size            int64
	CreatedAt       time.Time
}

// Service provides storage operations over a Backend.
type Service struct{ backend Backend }

// NewService constructs a storage service.
func NewService(b Backend) *Service { return &Service{backend: b} }

// Save stores content and returns SaveResult with metadata.
func (s *Service) Save(ctx context.Context, key string, r io.Reader, name string) (*SaveResult, error) {
	path, err := s.backend.Save(ctx, key, r)
	if err != nil {
		return nil, err
	}
	mt := mime.TypeByExtension(filepath.Ext(name))
	var size int64
	if fi, err := os.Stat(path); err == nil {
		size = fi.Size()
	}
	return &SaveResult{Key: key, Path: path, Size: size, Mime: mt, CreatedAt: time.Now()}, nil
}

// Open returns reader, size and mime by key. Convenience wrapper
// around `Backend.Open(ctx, key, nil)` for callers that always want
// the full body.
func (s *Service) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	return s.backend.Open(ctx, key, nil)
}

// Delete removes content by key.
func (s *Service) Delete(ctx context.Context, key string) error {
	return s.backend.Delete(ctx, key)
}
