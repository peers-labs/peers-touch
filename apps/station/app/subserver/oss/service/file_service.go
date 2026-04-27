package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"path/filepath"
	"strings"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	touchutil "github.com/peers-labs/peers-touch/station/frame/touch/util"
)

// KeyStrategy controls how `SaveFile` derives the storage key.
//
//   - `KeyStrategyRandom` (default): legacy `YYYY/MM/DD/<rand>.<ext>`.
//     Every upload produces a new key — no deduplication, no
//     content-integrity guarantee.
//   - `KeyStrategyCAS`: `cas/<sha256[0:2]>/<sha256>.<ext>`. Uploading
//     the same bytes twice returns the *first* `FileMeta` row without
//     re-saving — saves disk and is the prerequisite for end-to-end
//     content verification on the receive side.
//
// The strategy is per-server (set via `Options.KeyStrategy`); it is
// not switchable per request because it would create unbounded
// fan-out of equivalent metas pointing at the same bytes.
type KeyStrategy string

const (
	// KeyStrategyRandom assigns a fresh random key per upload (legacy default).
	KeyStrategyRandom KeyStrategy = "random"
	// KeyStrategyCAS derives the key from sha256(content), enabling dedup.
	KeyStrategyCAS KeyStrategy = "cas"
)

// PrepareUploadRequest is the client-side claim that opens a
// presigned upload session. We never trust these values without
// validation in `CompleteUpload`, but the server uses them to:
//
//   - pick the right storage key (CAS short-circuits on existing rows);
//   - bind a SHA-256 into the presign signature when the strategy is `cas`;
//   - reject grossly oversized uploads up-front instead of after the bytes have moved.
type PrepareUploadRequest struct {
	Filename    string
	ContentType string
	Size        int64
	Sha256      string
}

// PrepareUploadResult tells the caller what to do next. When
// `AlreadyUploaded` is true the bytes are already at `Meta.Key` (CAS
// dedup); the client skips the PUT entirely. Otherwise it follows
// `Method` + `URL` + `Headers` and then calls `CompleteUpload`.
type PrepareUploadResult struct {
	Meta            *ossmodel.FileMeta
	AlreadyUploaded bool
	Method          string
	URL             string
	Headers         map[string]string
	ExpiresAt       time.Time
	MaxBytes        int64
}

// CompleteUploadRequest is the post-PUT registration call. The
// server independently `Head`s the object to validate the claimed
// size and (when CAS) the bound SHA-256, then writes the FileMeta
// row. Idempotent — concurrent uploaders of identical CAS bytes get
// the winner's row back.
type CompleteUploadRequest struct {
	Key         string
	Filename    string
	ContentType string
	Size        int64
	Sha256      string
}

// FileService is the application-layer entry point for everything the
// HTTP handlers need to do with object metadata + bytes. The legacy
// multipart `SaveFile` and the new `PrepareUpload` / `CompleteUpload`
// pair coexist intentionally: each is a complete data path for its
// size class, and switching between them is per-request, not per-server.
type FileService interface {
	SaveFile(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error)
	GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error)
	PrepareUpload(ctx context.Context, presigner storage.PresignedBackend, req PrepareUploadRequest, ttl time.Duration) (PrepareUploadResult, error)
	CompleteUpload(ctx context.Context, presigner storage.PresignedBackend, req CompleteUploadRequest) (*ossmodel.FileMeta, error)
}

type fileService struct {
	repo        ossrepo.FileRepository
	backend     storage.Backend
	backendName string
	strategy    KeyStrategy
}

// NewFileService constructs the service with the legacy `random` key
// strategy. Use `NewFileServiceWith` to pick CAS.
func NewFileService(repo ossrepo.FileRepository, backend storage.Backend) FileService {
	return NewFileServiceWith(repo, backend, KeyStrategyRandom, "local")
}

// NewFileServiceWith allows the operator-configured strategy /
// backend label to be threaded through. `backendName` is recorded
// verbatim in `FileMeta.Backend` so the file plane can be migrated
// later without losing provenance.
func NewFileServiceWith(repo ossrepo.FileRepository, backend storage.Backend, strategy KeyStrategy, backendName string) FileService {
	if strategy == "" {
		strategy = KeyStrategyRandom
	}
	if backendName == "" {
		backendName = "local"
	}
	return &fileService{
		repo:        repo,
		backend:     backend,
		backendName: backendName,
		strategy:    strategy,
	}
}

func (s *fileService) SaveFile(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	if s.strategy == KeyStrategyCAS {
		return s.saveCAS(ctx, file, header)
	}
	return s.saveRandom(ctx, file, header)
}

func (s *fileService) saveRandom(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	rnd, _ := touchutil.RandomString(16)
	ext := filepath.Ext(header.Filename)
	day := time.Now().Format("2006/01/02")
	// Use forward slash explicitly for OSS keys to be cross-platform and URL friendly
	key := day + "/" + rnd + ext

	fullPath, err := s.backend.Save(ctx, key, file)
	if err != nil {
		return nil, err
	}

	meta := &ossmodel.FileMeta{
		ID:        rnd,
		Key:       key,
		Name:      header.Filename,
		Size:      header.Size,
		Mime:      detectMime(ext),
		Backend:   s.backendName,
		Path:      fullPath,
		CreatedAt: time.Now(),
	}

	if err := s.repo.Create(ctx, meta); err != nil {
		return nil, err
	}

	return meta, nil
}

// saveCAS hashes the upload, derives a content-addressable key, and
// returns the *existing* FileMeta if those bytes were already
// uploaded by anyone (any user) on this Station.
//
// We rely on `multipart.File` being seekable — Go's mime/multipart
// implementation keeps small parts in memory and spills large parts
// to a temp file, both of which are seekable. This lets us hash in
// one pass and write in a second pass without a hand-rolled temp
// file management layer.
//
// Race-condition handling: two concurrent uploads of the same bytes
// hit FindByKey-miss → both call backend.Save (writing the same
// bytes to the same key — backend's responsibility to make atomic),
// then one of them wins the unique-index Create and the other
// catches the duplicate-key error and returns the winner's meta.
func (s *fileService) saveCAS(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return nil, err
	}
	sum := hex.EncodeToString(h.Sum(nil))

	ext := strings.ToLower(filepath.Ext(header.Filename))
	key := casKey(sum, ext)

	if existing, err := s.repo.FindByKey(ctx, key); err == nil && existing != nil && existing.Key == key {
		return existing, nil
	}

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	fullPath, err := s.backend.Save(ctx, key, file)
	if err != nil {
		return nil, err
	}

	meta := &ossmodel.FileMeta{
		ID:        sum,
		Key:       key,
		Name:      header.Filename,
		Size:      header.Size,
		Mime:      detectMime(ext),
		Backend:   s.backendName,
		Path:      fullPath,
		Sha256:    sum,
		CreatedAt: time.Now(),
	}

	if err := s.repo.Create(ctx, meta); err != nil {
		// Most likely a uniqueIndex collision from a concurrent
		// uploader of the same bytes. Read back the winner.
		if existing, err2 := s.repo.FindByKey(ctx, key); err2 == nil && existing != nil && existing.Key == key {
			return existing, nil
		}
		return nil, err
	}
	return meta, nil
}

// PrepareUpload opens a presigned upload session. Two short-circuits
// happen here, in priority order:
//
//  1. CAS dedup — when the strategy is `cas` and the SHA-256 the
//     client supplied already maps to a `FileMeta` row, we return
//     that meta with `AlreadyUploaded: true`. The client never
//     transfers the bytes again.
//
//  2. Driver-level presign failure — when the active backend's
//     `PresignPut` fails (config error, connectivity), we surface
//     the error rather than silently falling back to multipart, so
//     the client can retry through the documented path.
//
// The returned key is *not* yet persisted — the row is created in
// `CompleteUpload` only after the bytes have actually landed and
// passed validation. This mirrors the multipart path's "save then
// register" ordering.
func (s *fileService) PrepareUpload(ctx context.Context, presigner storage.PresignedBackend, req PrepareUploadRequest, ttl time.Duration) (PrepareUploadResult, error) {
	if presigner == nil {
		return PrepareUploadResult{}, ErrPresignUnsupported
	}
	if req.Size <= 0 {
		return PrepareUploadResult{}, errors.New("oss: size is required for presigned upload")
	}
	if strings.TrimSpace(req.Filename) == "" {
		return PrepareUploadResult{}, errors.New("oss: filename is required for presigned upload")
	}

	ext := strings.ToLower(filepath.Ext(req.Filename))
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = detectMime(ext)
	}

	var key string
	if s.strategy == KeyStrategyCAS {
		if !validSha256Hex(req.Sha256) {
			return PrepareUploadResult{}, errors.New("oss: cas strategy requires sha256 (64-char hex) on presigned upload")
		}
		key = casKey(req.Sha256, ext)
		if existing, err := s.repo.FindByKey(ctx, key); err == nil && existing != nil && existing.Key == key {
			return PrepareUploadResult{
				Meta:            existing,
				AlreadyUploaded: true,
			}, nil
		}
	} else {
		rnd, _ := touchutil.RandomString(16)
		day := time.Now().Format("2006/01/02")
		key = day + "/" + rnd + ext
	}

	pr, err := presigner.PresignPut(ctx, key, contentType, req.Size, req.Sha256, ttl)
	if err != nil {
		return PrepareUploadResult{}, fmt.Errorf("oss: presign put: %w", err)
	}

	return PrepareUploadResult{
		Meta: &ossmodel.FileMeta{
			Key:     key,
			Name:    req.Filename,
			Size:    req.Size,
			Mime:    contentType,
			Backend: s.backendName,
			Sha256:  req.Sha256,
		},
		Method:    pr.Method,
		URL:       pr.URL,
		Headers:   pr.Headers,
		ExpiresAt: pr.ExpiresAt,
		MaxBytes:  pr.MaxBytes,
	}, nil
}

// CompleteUpload registers a successful presigned upload as a
// `FileMeta` row. The caller must already have PUT the bytes to the
// presigned URL. We `HeadObject` to confirm the bytes landed and the
// claimed size is honest, then `Create`. If a concurrent uploader
// won the row first (CAS), we return their meta — same idempotency
// contract as the multipart `saveCAS` path.
func (s *fileService) CompleteUpload(ctx context.Context, presigner storage.PresignedBackend, req CompleteUploadRequest) (*ossmodel.FileMeta, error) {
	if presigner == nil {
		return nil, ErrPresignUnsupported
	}
	if strings.TrimSpace(req.Key) == "" {
		return nil, errors.New("oss: key is required for upload-complete")
	}

	if existing, err := s.repo.FindByKey(ctx, req.Key); err == nil && existing != nil && existing.Key == req.Key {
		return existing, nil
	}

	head, err := presigner.HeadObject(ctx, req.Key)
	if err != nil {
		return nil, fmt.Errorf("oss: head after presigned put: %w", err)
	}
	if req.Size > 0 && head.Size != req.Size {
		return nil, fmt.Errorf("oss: upload size mismatch (claimed=%d, actual=%d)", req.Size, head.Size)
	}
	if s.strategy == KeyStrategyCAS {
		if !validSha256Hex(req.Sha256) {
			return nil, errors.New("oss: cas strategy requires sha256 on upload-complete")
		}
		if head.Sha256 != "" && !strings.EqualFold(head.Sha256, req.Sha256) {
			return nil, fmt.Errorf("oss: sha256 mismatch (claimed=%s, store=%s)", req.Sha256, head.Sha256)
		}
	}

	id := req.Sha256
	if id == "" {
		id, _ = touchutil.RandomString(16)
	}
	mt := strings.TrimSpace(req.ContentType)
	if mt == "" {
		if head.Mime != "" {
			mt = head.Mime
		} else {
			mt = detectMime(strings.ToLower(filepath.Ext(req.Filename)))
		}
	}

	meta := &ossmodel.FileMeta{
		ID:        id,
		Key:       req.Key,
		Name:      req.Filename,
		Size:      head.Size,
		Mime:      mt,
		Backend:   s.backendName,
		Path:      "", // S3 has no filesystem path; key is authoritative.
		Sha256:    req.Sha256,
		CreatedAt: time.Now(),
	}
	if err := s.repo.Create(ctx, meta); err != nil {
		// Concurrent winner — return their row.
		if existing, err2 := s.repo.FindByKey(ctx, req.Key); err2 == nil && existing != nil && existing.Key == req.Key {
			return existing, nil
		}
		return nil, err
	}
	return meta, nil
}

func (s *fileService) GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	return s.repo.FindByKey(ctx, key)
}

// ErrPresignUnsupported is returned by `PrepareUpload` /
// `CompleteUpload` when the active backend does not implement
// `storage.PresignedBackend`. Handlers translate it to a clear HTTP
// 501 so clients know to fall through to the multipart path.
var ErrPresignUnsupported = errors.New("oss: active backend does not support presigned uploads")

// casKey computes the canonical content-addressable storage key. The
// `<2-char shard>` prefix keeps any single directory bounded as the
// dataset grows.
func casKey(sha256Hex, ext string) string {
	key := "cas/" + sha256Hex[:2] + "/" + sha256Hex
	if ext != "" {
		key += ext
	}
	return key
}

// validSha256Hex returns true when `s` is the canonical 64-char hex
// shape we accept on the wire. We do not lower-case the input — the
// caller is expected to canonicalise upstream so that two clients
// uploading identical bytes converge on the same CAS key.
func validSha256Hex(s string) bool {
	if len(s) != sha256.Size*2 {
		return false
	}
	for _, c := range s {
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		case c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
}

func detectMime(ext string) string {
	mt := mime.TypeByExtension(ext)
	if mt == "" {
		return "application/octet-stream"
	}
	return mt
}
