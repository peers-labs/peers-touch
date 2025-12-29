package storage

import (
	"context"
	"io"
	"mime"
	"os"
	"path/filepath"
	"time"
)

// Backend defines storage backend operations.
type Backend interface {
	Save(ctx context.Context, key string, r io.Reader) (string, error)
	Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	Delete(ctx context.Context, key string) error
}

// LocalBackend stores files under a local root directory.
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
