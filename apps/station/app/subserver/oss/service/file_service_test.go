package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/textproto"
	"strings"
	"sync"
	"testing"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
)

// fakeRepo is an in-memory FileRepository good enough for verifying
// the CAS dedup contract. We deliberately avoid hitting GORM in unit
// tests so the service can be exercised without a database.
type fakeRepo struct {
	mu    sync.Mutex
	byKey map[string]*ossmodel.FileMeta
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{byKey: map[string]*ossmodel.FileMeta{}}
}

func (r *fakeRepo) Create(ctx context.Context, meta *ossmodel.FileMeta) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.byKey[meta.Key]; ok {
		return errors.New("UNIQUE constraint failed: oss_files.key")
	}
	cp := *meta
	r.byKey[meta.Key] = &cp
	return nil
}

func (r *fakeRepo) FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if m, ok := r.byKey[key]; ok {
		cp := *m
		return &cp, nil
	}
	return &ossmodel.FileMeta{}, errors.New("not found")
}

// fakeBackend records every Save call so the test can assert that
// dedup actually skipped the second write.
type fakeBackend struct {
	mu    sync.Mutex
	saved map[string][]byte
}

func newFakeBackend() *fakeBackend {
	return &fakeBackend{saved: map[string][]byte{}}
}

func (b *fakeBackend) Save(ctx context.Context, key string, r io.Reader) (string, error) {
	body, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.saved[key] = body
	return "/fake/" + key, nil
}

func (b *fakeBackend) Open(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	return nil, 0, "", errors.New("not implemented")
}

func (b *fakeBackend) Delete(ctx context.Context, key string) error { return nil }

func (b *fakeBackend) saveCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.saved)
}

// makePart builds a seekable multipart.File + header for the given
// bytes. We piggy-back on the real `mime/multipart.Reader` so the
// test code path matches what the HTTP handler hands to SaveFile.
func makePart(t *testing.T, filename string, body []byte) (multipart.File, *multipart.FileHeader) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	hdr := make(textproto.MIMEHeader)
	hdr.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	hdr.Set("Content-Type", "application/octet-stream")
	part, err := w.CreatePart(hdr)
	if err != nil {
		t.Fatalf("CreatePart: %v", err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatalf("part.Write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}

	r := multipart.NewReader(&buf, w.Boundary())
	form, err := r.ReadForm(int64(len(body)) + 1024)
	if err != nil {
		t.Fatalf("ReadForm: %v", err)
	}
	fh := form.File["file"][0]
	f, err := fh.Open()
	if err != nil {
		t.Fatalf("fh.Open: %v", err)
	}
	t.Cleanup(func() { _ = f.Close(); _ = form.RemoveAll() })
	return f, fh
}

func TestSaveCAS_DeduplicatesIdenticalBytes(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "local")

	body := []byte("hello world, this is a chat attachment")

	// First upload — should create a new meta and write through.
	f1, h1 := makePart(t, "note.txt", body)
	m1, err := svc.SaveFile(context.Background(), f1, h1)
	if err != nil {
		t.Fatalf("first SaveFile: %v", err)
	}
	if !strings.HasPrefix(m1.Key, "cas/") {
		t.Fatalf("expected cas/ key, got %q", m1.Key)
	}
	if m1.Sha256 == "" {
		t.Fatal("expected sha256 to be populated for CAS")
	}
	if backend.saveCount() != 1 {
		t.Fatalf("expected 1 backend save, got %d", backend.saveCount())
	}

	// Second upload of the *same bytes*. Could come in with a
	// different filename — CAS still dedups because the key is
	// derived from content.
	f2, h2 := makePart(t, "RENAMED.txt", body)
	m2, err := svc.SaveFile(context.Background(), f2, h2)
	if err != nil {
		t.Fatalf("second SaveFile: %v", err)
	}
	if m2.Key != m1.Key {
		t.Fatalf("expected dedup → same key, got %q vs %q", m2.Key, m1.Key)
	}
	if backend.saveCount() != 1 {
		t.Fatalf("CAS should not re-save bytes, but backend has %d entries", backend.saveCount())
	}
	// Original meta wins — the renamed second upload does not
	// pollute the canonical filename. This matters for the chat
	// path because the filename shown in older messages stays
	// stable.
	if m2.Name != m1.Name {
		t.Fatalf("dedup should return original meta, got name=%q want %q", m2.Name, m1.Name)
	}
}

func TestSaveCAS_DifferentBytesGetDifferentKeys(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "local")

	f1, h1 := makePart(t, "a.txt", []byte("alpha"))
	m1, err := svc.SaveFile(context.Background(), f1, h1)
	if err != nil {
		t.Fatalf("save a: %v", err)
	}
	f2, h2 := makePart(t, "b.txt", []byte("beta"))
	m2, err := svc.SaveFile(context.Background(), f2, h2)
	if err != nil {
		t.Fatalf("save b: %v", err)
	}
	if m1.Key == m2.Key {
		t.Fatal("distinct content must hash to distinct CAS keys")
	}
	if backend.saveCount() != 2 {
		t.Fatalf("expected 2 backend saves, got %d", backend.saveCount())
	}
}

func TestSaveRandom_StillTimestampsLegacyKeys(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyRandom, "local")

	f, h := makePart(t, "img.png", []byte("ignored"))
	m, err := svc.SaveFile(context.Background(), f, h)
	if err != nil {
		t.Fatalf("SaveFile: %v", err)
	}
	if strings.HasPrefix(m.Key, "cas/") {
		t.Fatalf("random strategy should not produce cas/ keys, got %q", m.Key)
	}
	if m.Sha256 != "" {
		t.Fatalf("random strategy must leave Sha256 empty, got %q", m.Sha256)
	}
}
