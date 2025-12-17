package storage

import (
	"context"
	"io"
	"mime"
	"os"
	"path/filepath"
	"time"
)

type StorageBackend interface {
	Save(ctx context.Context, key string, r io.Reader) (string, error)
	Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	Delete(ctx context.Context, key string) error
}

type LocalBackend struct {
	root string
}

func NewLocalBackend(root string) *LocalBackend { return &LocalBackend{root: root} }

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

func (b *LocalBackend) Delete(ctx context.Context, key string) error {
	full := filepath.Join(b.root, key)
	return os.Remove(full)
}

type SaveResult struct {
	Key       string
	Path      string
	Size      int64
	Mime      string
	CreatedAt time.Time
}

type Service struct {
	backend StorageBackend
}

func NewService(b StorageBackend) *Service { return &Service{backend: b} }

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

func (s *Service) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	return s.backend.Open(ctx, key)
}

func (s *Service) Delete(ctx context.Context, key string) error {
	return s.backend.Delete(ctx, key)
}
