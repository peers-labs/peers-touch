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
	"io"
	"mime"
	"os"
	"path/filepath"
	"time"
)

// Backend defines the minimum contract every storage driver must
// satisfy. Save streams bytes from `r` into the object identified by
// `key`; Open returns a reader plus the standard metadata triple
// (size, mime, error); Delete removes the object. Implementations are
// expected to be safe for concurrent use.
type Backend interface {
	Save(ctx context.Context, key string, r io.Reader) (string, error)
	Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	Delete(ctx context.Context, key string) error
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
// `docs/architecture/oss/file-storage.md`.
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
func (b *LocalBackend) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	full := filepath.Join(b.root, key)
	f, err := os.Open(full)
	if err != nil {
		return nil, 0, "", err
	}
	st, _ := f.Stat()
	mt := mime.TypeByExtension(filepath.Ext(full))
	return f, st.Size(), mt, nil
}

// Delete removes the stored item by key.
func (b *LocalBackend) Delete(ctx context.Context, key string) error {
	return os.Remove(filepath.Join(b.root, key))
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

// Open returns reader, size and mime by key.
func (s *Service) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	return s.backend.Open(ctx, key)
}

// Delete removes content by key.
func (s *Service) Delete(ctx context.Context, key string) error {
	return s.backend.Delete(ctx, key)
}
