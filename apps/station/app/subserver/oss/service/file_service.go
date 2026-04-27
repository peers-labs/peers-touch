package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	KeyStrategyRandom KeyStrategy = "random"
	KeyStrategyCAS    KeyStrategy = "cas"
)

type FileService interface {
	SaveFile(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error)
	GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error)
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
	// `cas/<2-char shard>/<full hash><ext>` — the shard prefix keeps
	// any single directory bounded as the dataset grows.
	key := "cas/" + sum[:2] + "/" + sum
	if ext != "" {
		key += ext
	}

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

func (s *fileService) GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	return s.repo.FindByKey(ctx, key)
}

func detectMime(ext string) string {
	mt := mime.TypeByExtension(ext)
	if mt == "" {
		return "application/octet-stream"
	}
	return mt
}
