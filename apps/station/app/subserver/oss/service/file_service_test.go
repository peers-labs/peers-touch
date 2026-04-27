package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime/multipart"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
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

// fakePresignBackend is a minimal `storage.PresignedBackend` for
// service-layer tests. It returns deterministic URLs and a
// caller-controlled HEAD response so we can exercise both the dedup
// short-circuit and the size/sha256 validation paths in
// CompleteUpload without spinning up a real S3-protocol server.
type fakePresignBackend struct {
	mu          sync.Mutex
	headSize    int64
	headSha256  string
	failPresign bool
	failHead    bool
}

func (b *fakePresignBackend) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (b *fakePresignBackend) Open(context.Context, string) (io.ReadCloser, int64, string, error) {
	return nil, 0, "", errors.New("not implemented")
}
func (b *fakePresignBackend) Delete(context.Context, string) error { return nil }

func (b *fakePresignBackend) PresignPut(_ context.Context, key, contentType string, contentLength int64, sha256Hex string, ttl time.Duration) (storage.PresignedRequest, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.failPresign {
		return storage.PresignedRequest{}, errors.New("presign failure")
	}
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	if sha256Hex != "" {
		headers["x-amz-checksum-sha256"] = sha256Hex
	}
	return storage.PresignedRequest{
		Method:    "PUT",
		URL:       "https://fake.example.com/" + key,
		Headers:   headers,
		MaxBytes:  contentLength,
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

func (b *fakePresignBackend) PresignGet(_ context.Context, key string, ttl time.Duration) (storage.PresignedRequest, error) {
	return storage.PresignedRequest{
		Method:    "GET",
		URL:       "https://fake.example.com/" + key,
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

func (b *fakePresignBackend) HeadObject(context.Context, string) (storage.HeadInfo, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.failHead {
		return storage.HeadInfo{}, errors.New("head failure")
	}
	return storage.HeadInfo{
		Size:   b.headSize,
		Sha256: b.headSha256,
	}, nil
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// TestPrepareUpload_CASShortCircuit verifies that PrepareUpload
// returns the existing FileMeta with `AlreadyUploaded: true` when a
// CAS row already exists for the supplied SHA-256. This is the
// architectural guarantee that makes the presigned data path safe
// to use for chat — duplicate uploads never round-trip through S3.
func TestPrepareUpload_CASShortCircuit(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "s3")

	body := []byte("hello presigned")
	digest := sha256Hex(body)
	preExisting := &ossmodel.FileMeta{
		ID:      digest,
		Key:     casKey(digest, ".txt"),
		Name:    "first.txt",
		Size:    int64(len(body)),
		Backend: "s3",
		Sha256:  digest,
	}
	if err := repo.Create(context.Background(), preExisting); err != nil {
		t.Fatalf("seed: %v", err)
	}

	pb := &fakePresignBackend{}
	res, err := svc.PrepareUpload(context.Background(), pb, PrepareUploadRequest{
		Filename:    "second.txt",
		ContentType: "text/plain",
		Size:        int64(len(body)),
		Sha256:      digest,
	}, time.Minute)
	if err != nil {
		t.Fatalf("PrepareUpload: %v", err)
	}
	if !res.AlreadyUploaded {
		t.Fatal("expected AlreadyUploaded=true on CAS hit")
	}
	if res.Meta.Name != "first.txt" {
		t.Errorf("dedup should return original filename; got %q", res.Meta.Name)
	}
}

// TestPrepareUpload_CAS_RequiresSha256 verifies the strategy contract:
// CAS keys are derived from sha256, so the client *must* declare it
// up-front. We refuse to silently degrade to random keying because
// that would defeat the dedup invariant.
func TestPrepareUpload_CAS_RequiresSha256(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "s3")
	pb := &fakePresignBackend{}

	_, err := svc.PrepareUpload(context.Background(), pb, PrepareUploadRequest{
		Filename: "file.bin", Size: 1024,
	}, time.Minute)
	if err == nil {
		t.Fatal("expected error when CAS upload omits sha256")
	}
	if !strings.Contains(err.Error(), "sha256") {
		t.Errorf("error should mention sha256, got: %v", err)
	}
}

// TestPrepareUpload_RandomReturnsFreshKey — random strategy never
// short-circuits on dedup; every call yields a new dated key.
func TestPrepareUpload_RandomReturnsFreshKey(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyRandom, "s3")
	pb := &fakePresignBackend{}

	first, err := svc.PrepareUpload(context.Background(), pb, PrepareUploadRequest{
		Filename: "img.png", Size: 1024,
	}, time.Minute)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := svc.PrepareUpload(context.Background(), pb, PrepareUploadRequest{
		Filename: "img.png", Size: 1024,
	}, time.Minute)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if first.Meta.Key == second.Meta.Key {
		t.Errorf("random strategy must yield unique keys, got %q twice", first.Meta.Key)
	}
	if first.AlreadyUploaded || second.AlreadyUploaded {
		t.Errorf("random strategy never dedups, but AlreadyUploaded was set")
	}
}

// TestCompleteUpload_HappyPath_CAS — bytes uploaded, head returns
// matching size + sha256, FileMeta row gets created. This is the
// terminal step of the presigned data path.
func TestCompleteUpload_HappyPath_CAS(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "s3")

	body := []byte("complete me")
	digest := sha256Hex(body)
	pb := &fakePresignBackend{headSize: int64(len(body)), headSha256: digest}

	meta, err := svc.CompleteUpload(context.Background(), pb, CompleteUploadRequest{
		Key:      casKey(digest, ".bin"),
		Filename: "complete.bin",
		Size:     int64(len(body)),
		Sha256:   digest,
	})
	if err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}
	if meta.Sha256 != digest {
		t.Errorf("Sha256 = %q, want %q", meta.Sha256, digest)
	}
	if meta.Backend != "s3" {
		t.Errorf("Backend = %q, want s3", meta.Backend)
	}
}

// TestCompleteUpload_RejectsSizeMismatch — claimed size disagrees
// with what actually landed in the bucket. This is the integrity
// gate that prevents a client lying about the upload from polluting
// the FileMeta table.
func TestCompleteUpload_RejectsSizeMismatch(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyRandom, "s3")
	pb := &fakePresignBackend{headSize: 999}

	_, err := svc.CompleteUpload(context.Background(), pb, CompleteUploadRequest{
		Key:      "2026/04/27/abc.bin",
		Filename: "abc.bin",
		Size:     1024,
	})
	if err == nil {
		t.Fatal("expected size mismatch error")
	}
	if !strings.Contains(err.Error(), "size mismatch") {
		t.Errorf("error should mention size mismatch, got: %v", err)
	}
}

// TestCompleteUpload_RejectsSha256Mismatch — when the bucket reports
// a SHA-256 (because the client bound `x-amz-checksum-sha256`) and
// it diverges from what the client claimed, we refuse to register
// the upload. This is the end-to-end integrity contract for CAS.
func TestCompleteUpload_RejectsSha256Mismatch(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "s3")
	pb := &fakePresignBackend{
		headSize:   10,
		headSha256: strings.Repeat("a", 64),
	}

	_, err := svc.CompleteUpload(context.Background(), pb, CompleteUploadRequest{
		Key:      "cas/bb/" + strings.Repeat("b", 64) + ".bin",
		Filename: "x.bin",
		Size:     10,
		Sha256:   strings.Repeat("b", 64),
	})
	if err == nil {
		t.Fatal("expected sha256 mismatch error")
	}
	if !strings.Contains(err.Error(), "sha256 mismatch") {
		t.Errorf("error should mention sha256 mismatch, got: %v", err)
	}
}

// TestCompleteUpload_IdempotentOnExistingKey — concurrent uploaders
// of identical CAS bytes call CompleteUpload on the same key. The
// second call sees the existing row and returns it instead of
// erroring on the unique-index collision.
func TestCompleteUpload_IdempotentOnExistingKey(t *testing.T) {
	repo := newFakeRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(repo, backend, KeyStrategyCAS, "s3")
	digest := strings.Repeat("c", 64)
	preExisting := &ossmodel.FileMeta{
		ID: digest, Key: casKey(digest, ".bin"), Name: "winner.bin",
		Backend: "s3", Sha256: digest, Size: 5,
	}
	if err := repo.Create(context.Background(), preExisting); err != nil {
		t.Fatalf("seed: %v", err)
	}
	pb := &fakePresignBackend{headSize: 5, headSha256: digest}

	got, err := svc.CompleteUpload(context.Background(), pb, CompleteUploadRequest{
		Key:      preExisting.Key,
		Filename: "loser.bin",
		Size:     5,
		Sha256:   digest,
	})
	if err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}
	if got.Name != "winner.bin" {
		t.Errorf("expected winner's filename, got %q", got.Name)
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
