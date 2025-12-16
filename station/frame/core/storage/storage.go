package storage

import (
    "context"
    "io"
    "mime"
    "os"
    "path/filepath"
    "time"
)

type Driver interface {
    Save(ctx context.Context, key string, r io.Reader) (string, error)
    Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
    Delete(ctx context.Context, key string) error
}

type LocalDriver struct{
    root string
}

func NewLocalDriver(root string) *LocalDriver { return &LocalDriver{root: root} }

func (d *LocalDriver) Save(ctx context.Context, key string, r io.Reader) (string, error) {
    full := filepath.Join(d.root, key)
    if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil { return "", err }
    f, err := os.Create(full)
    if err != nil { return "", err }
    defer f.Close()
    if _, err = io.Copy(f, r); err != nil { return "", err }
    return full, nil
}

func (d *LocalDriver) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
    full := filepath.Join(d.root, key)
    f, err := os.Open(full)
    if err != nil { return nil, 0, "", err }
    st, _ := f.Stat()
    mt := mime.TypeByExtension(filepath.Ext(full))
    return f, st.Size(), mt, nil
}

func (d *LocalDriver) Delete(ctx context.Context, key string) error {
    full := filepath.Join(d.root, key)
    return os.Remove(full)
}

type SaveResult struct{
    Key string
    Path string
    Size int64
    Mime string
    CreatedAt time.Time
}

type Service struct{
    driver Driver
}

func NewService(d Driver) *Service { return &Service{driver: d} }

func (s *Service) Save(ctx context.Context, key string, r io.Reader, name string) (*SaveResult, error) {
    path, err := s.driver.Save(ctx, key, r)
    if err != nil { return nil, err }
    mt := mime.TypeByExtension(filepath.Ext(name))
    var size int64
    if fi, err := os.Stat(path); err == nil { size = fi.Size() }
    return &SaveResult{Key: key, Path: path, Size: size, Mime: mt, CreatedAt: time.Now()}, nil
}

func (s *Service) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
    return s.driver.Open(ctx, key)
}

func (s *Service) Delete(ctx context.Context, key string) error {
    return s.driver.Delete(ctx, key)
}
