package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

const (
	testActorA = "did:test:alice"
	testActorB = "did:test:bob"
)

// defaultAttr returns a chat-bucket UploadAttribution for the given
// actor. Tests that need a different bucket / visibility build their
// own UploadAttribution literally — this helper keeps the common
// case readable.
func defaultAttr(actor string) UploadAttribution {
	return UploadAttribution{
		ActorID:       actor,
		BucketName:    ossmodel.SystemBucketChat,
		Visibility:    ossmodel.VisibilityChat,
		ChatSessionID: "session-test",
	}
}

// fakeFileRepo is an in-memory FileRepository good enough for
// verifying the upload-path contract. We deliberately avoid hitting
// GORM in unit tests so the service can be exercised without a
// database. The composite (owner, key) uniqueness is enforced
// explicitly here to mirror the production schema.
type fakeFileRepo struct {
	mu    sync.Mutex
	byPK  map[string]*ossmodel.FileMeta // keyed by owner+"|"+key
	byKey map[string][]*ossmodel.FileMeta
}

func newFakeFileRepo() *fakeFileRepo {
	return &fakeFileRepo{
		byPK:  map[string]*ossmodel.FileMeta{},
		byKey: map[string][]*ossmodel.FileMeta{},
	}
}

func ownerKeyPK(owner, key string) string { return owner + "|" + key }

func (r *fakeFileRepo) Create(ctx context.Context, meta *ossmodel.FileMeta) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	pk := ownerKeyPK(meta.OwnerActorID, meta.Key)
	if _, ok := r.byPK[pk]; ok {
		return errors.New("UNIQUE constraint failed: oss_files(owner_actor_id, key)")
	}
	cp := *meta
	r.byPK[pk] = &cp
	r.byKey[meta.Key] = append(r.byKey[meta.Key], &cp)
	return nil
}

func (r *fakeFileRepo) FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if rows, ok := r.byKey[key]; ok && len(rows) > 0 {
		cp := *rows[0]
		return &cp, nil
	}
	return &ossmodel.FileMeta{}, errors.New("not found")
}

func (r *fakeFileRepo) FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if m, ok := r.byPK[ownerKeyPK(owner, key)]; ok {
		cp := *m
		return &cp, nil
	}
	return &ossmodel.FileMeta{}, errors.New("not found")
}

// fakeBucketRepo is an in-memory BucketRepository. EnsureSystem and
// AddUsage track usage atomically enough for the tests we run; we
// do not pretend to model concurrent transactions.
type fakeBucketRepo struct {
	mu       sync.Mutex
	byID     map[string]*ossmodel.Bucket
	byOwner  map[string]map[string]*ossmodel.Bucket // owner -> name -> bucket
	nextULID int
}

func newFakeBucketRepo() *fakeBucketRepo {
	return &fakeBucketRepo{
		byID:    map[string]*ossmodel.Bucket{},
		byOwner: map[string]map[string]*ossmodel.Bucket{},
	}
}

func (r *fakeBucketRepo) FindByID(_ context.Context, id string) (*ossmodel.Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if b, ok := r.byID[id]; ok {
		cp := *b
		return &cp, nil
	}
	return nil, ossrepo.ErrBucketNotFound
}

func (r *fakeBucketRepo) FindByOwnerName(_ context.Context, owner, name string) (*ossmodel.Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if m, ok := r.byOwner[owner]; ok {
		if b, ok := m[name]; ok {
			cp := *b
			return &cp, nil
		}
	}
	return nil, ossrepo.ErrBucketNotFound
}

func (r *fakeBucketRepo) ListByOwner(_ context.Context, owner string) ([]ossmodel.Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []ossmodel.Bucket{}
	for _, b := range r.byOwner[owner] {
		out = append(out, *b)
	}
	return out, nil
}

func (r *fakeBucketRepo) ListAll(_ context.Context) ([]ossmodel.Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []ossmodel.Bucket{}
	for _, b := range r.byID {
		out = append(out, *b)
	}
	return out, nil
}

func (r *fakeBucketRepo) Create(_ context.Context, b *ossmodel.Bucket) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.byOwner[b.OwnerActorID] == nil {
		r.byOwner[b.OwnerActorID] = map[string]*ossmodel.Bucket{}
	}
	if _, ok := r.byOwner[b.OwnerActorID][b.Name]; ok {
		return ossrepo.ErrBucketExists
	}
	if b.ID == "" {
		r.nextULID++
		b.ID = fmt.Sprintf("blk_%05d", r.nextULID)
	}
	cp := *b
	r.byID[b.ID] = &cp
	r.byOwner[b.OwnerActorID][b.Name] = &cp
	return nil
}

func (r *fakeBucketRepo) EnsureSystem(ctx context.Context, actorID string, spec ossmodel.SystemBucketSpec) (*ossmodel.Bucket, error) {
	if existing, err := r.FindByOwnerName(ctx, actorID, spec.Name); err == nil {
		return existing, nil
	} else if !errors.Is(err, ossrepo.ErrBucketNotFound) {
		return nil, err
	}
	b := &ossmodel.Bucket{
		Name:              spec.Name,
		OwnerActorID:      actorID,
		Kind:              spec.Kind,
		SystemKey:         spec.SystemKey,
		DefaultVisibility: spec.DefaultVisibility,
		QuotaBytes:        spec.QuotaBytes,
		TTLDays:           spec.TTLDays,
		Description:       spec.Description,
	}
	if err := r.Create(ctx, b); err != nil {
		return nil, err
	}
	return r.FindByOwnerName(ctx, actorID, spec.Name)
}

func (r *fakeBucketRepo) AddUsage(_ context.Context, bucketID string, deltaBytes int64) error {
	if deltaBytes == 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.byID[bucketID]
	if !ok {
		return ossrepo.ErrBucketNotFound
	}
	if deltaBytes > 0 && b.QuotaBytes > 0 && b.UsedBytes+deltaBytes > b.QuotaBytes {
		return ossrepo.ErrQuotaExceeded
	}
	b.UsedBytes += deltaBytes
	if deltaBytes > 0 {
		b.ObjectCount++
	} else {
		b.ObjectCount--
	}
	return nil
}

func (r *fakeBucketRepo) UpdatePolicy(_ context.Context, _ string, _ ossrepo.BucketPolicyUpdate) error {
	return nil
}
func (r *fakeBucketRepo) Delete(_ context.Context, _ string, _ bool) error { return nil }

// newSvc is the canonical wiring for service tests.
func newSvc(t *testing.T, strategy KeyStrategy, backendName string) (*fakeFileRepo, *fakeBucketRepo, *fakeBackend, FileService) {
	t.Helper()
	files := newFakeFileRepo()
	buckets := newFakeBucketRepo()
	backend := newFakeBackend()
	svc := NewFileServiceWith(files, buckets, backend, strategy, backendName)
	return files, buckets, backend, svc
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
	_, _, backend, svc := newSvc(t, KeyStrategyCAS, "local")

	body := []byte("hello world, this is a chat attachment")

	// First upload — should create a new meta and write through.
	f1, h1 := makePart(t, "note.txt", body)
	m1, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), f1, h1)
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

	// Second upload of the *same bytes* by the same actor. Could
	// come in with a different filename — CAS still dedups because
	// the key is derived from content and the (owner, key) tuple
	// matches.
	f2, h2 := makePart(t, "RENAMED.txt", body)
	m2, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), f2, h2)
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
	_, _, backend, svc := newSvc(t, KeyStrategyCAS, "local")

	f1, h1 := makePart(t, "a.txt", []byte("alpha"))
	m1, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), f1, h1)
	if err != nil {
		t.Fatalf("save a: %v", err)
	}
	f2, h2 := makePart(t, "b.txt", []byte("beta"))
	m2, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), f2, h2)
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
// CAS row already exists *for the same actor*. This is the
// architectural guarantee that makes the presigned data path safe
// to use for chat — the same actor's duplicate uploads never
// round-trip through S3.
func TestPrepareUpload_CASShortCircuit(t *testing.T) {
	repo, _, _, svc := newSvc(t, KeyStrategyCAS, "s3")

	body := []byte("hello presigned")
	digest := sha256Hex(body)
	preExisting := &ossmodel.FileMeta{
		ID:            digest,
		Key:           casKey(digest, ".txt"),
		Name:          "first.txt",
		Size:          int64(len(body)),
		Backend:       "s3",
		Sha256:        digest,
		OwnerActorID:  testActorA,
		BucketID:      "blk_seed",
		Visibility:    ossmodel.VisibilityChat,
		ChatSessionID: "session-seed",
	}
	if err := repo.Create(context.Background(), preExisting); err != nil {
		t.Fatalf("seed: %v", err)
	}

	pb := &fakePresignBackend{}
	res, err := svc.PrepareUpload(context.Background(), pb, defaultAttr(testActorA), PrepareUploadRequest{
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
	_, _, _, svc := newSvc(t, KeyStrategyCAS, "s3")
	pb := &fakePresignBackend{}

	_, err := svc.PrepareUpload(context.Background(), pb, defaultAttr(testActorA), PrepareUploadRequest{
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
	_, _, _, svc := newSvc(t, KeyStrategyRandom, "s3")
	pb := &fakePresignBackend{}

	first, err := svc.PrepareUpload(context.Background(), pb, defaultAttr(testActorA), PrepareUploadRequest{
		Filename: "img.png", Size: 1024,
	}, time.Minute)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := svc.PrepareUpload(context.Background(), pb, defaultAttr(testActorA), PrepareUploadRequest{
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
	_, _, _, svc := newSvc(t, KeyStrategyCAS, "s3")

	body := []byte("complete me")
	digest := sha256Hex(body)
	pb := &fakePresignBackend{headSize: int64(len(body)), headSha256: digest}

	meta, err := svc.CompleteUpload(context.Background(), pb, defaultAttr(testActorA), CompleteUploadRequest{
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
	_, _, _, svc := newSvc(t, KeyStrategyRandom, "s3")
	pb := &fakePresignBackend{headSize: 999}

	_, err := svc.CompleteUpload(context.Background(), pb, defaultAttr(testActorA), CompleteUploadRequest{
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
	_, _, _, svc := newSvc(t, KeyStrategyCAS, "s3")
	pb := &fakePresignBackend{
		headSize:   10,
		headSha256: strings.Repeat("a", 64),
	}

	_, err := svc.CompleteUpload(context.Background(), pb, defaultAttr(testActorA), CompleteUploadRequest{
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

// TestCompleteUpload_IdempotentOnExistingKey — the same actor calling
// CompleteUpload twice for an identical CAS upload sees the existing
// row and returns it instead of erroring on the (owner, key)
// unique-index collision.
func TestCompleteUpload_IdempotentOnExistingKey(t *testing.T) {
	repo, _, _, svc := newSvc(t, KeyStrategyCAS, "s3")
	digest := strings.Repeat("c", 64)
	preExisting := &ossmodel.FileMeta{
		ID: digest, Key: casKey(digest, ".bin"), Name: "winner.bin",
		Backend: "s3", Sha256: digest, Size: 5,
		OwnerActorID: testActorA, BucketID: "blk_seed",
		Visibility: ossmodel.VisibilityChat, ChatSessionID: "session-seed",
	}
	if err := repo.Create(context.Background(), preExisting); err != nil {
		t.Fatalf("seed: %v", err)
	}
	pb := &fakePresignBackend{headSize: 5, headSha256: digest}

	got, err := svc.CompleteUpload(context.Background(), pb, defaultAttr(testActorA), CompleteUploadRequest{
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

func TestSaveRandom_DatedKeys(t *testing.T) {
	_, _, _, svc := newSvc(t, KeyStrategyRandom, "local")

	f, h := makePart(t, "img.png", []byte("ignored"))
	m, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), f, h)
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

// TestSaveCAS_DifferentActorsClaimSeparateRows — actor A and actor B
// upload identical bytes; the storage backend writes once but each
// actor gets their own metadata row so visibility, bucket, and
// quota stay actor-scoped. This is the architectural distinction
// against the previous "first uploader wins, others read theirs"
// behaviour.
func TestSaveCAS_DifferentActorsClaimSeparateRows(t *testing.T) {
	files, buckets, backend, svc := newSvc(t, KeyStrategyCAS, "local")

	body := []byte("shared content")

	fA, hA := makePart(t, "alice.txt", body)
	mA, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), fA, hA)
	if err != nil {
		t.Fatalf("alice save: %v", err)
	}
	fB, hB := makePart(t, "bob.txt", body)
	mB, err := svc.SaveFile(context.Background(), defaultAttr(testActorB), fB, hB)
	if err != nil {
		t.Fatalf("bob save: %v", err)
	}

	if mA.Key != mB.Key {
		t.Fatalf("CAS bytes must converge on same key, got %q vs %q", mA.Key, mB.Key)
	}
	if mA.OwnerActorID == mB.OwnerActorID {
		t.Fatalf("two actors must produce two rows, both owned by %q", mA.OwnerActorID)
	}
	if backend.saveCount() < 1 {
		t.Fatal("backend must have stored the bytes at least once")
	}

	// Each owner has their own row in the file repo.
	if _, err := files.FindByOwnerKey(context.Background(), testActorA, mA.Key); err != nil {
		t.Fatalf("alice row missing: %v", err)
	}
	if _, err := files.FindByOwnerKey(context.Background(), testActorB, mA.Key); err != nil {
		t.Fatalf("bob row missing: %v", err)
	}

	// Both actors got their own chat bucket and were debited for
	// the upload independently.
	bA, err := buckets.FindByOwnerName(context.Background(), testActorA, ossmodel.SystemBucketChat)
	if err != nil {
		t.Fatalf("alice chat bucket: %v", err)
	}
	bB, err := buckets.FindByOwnerName(context.Background(), testActorB, ossmodel.SystemBucketChat)
	if err != nil {
		t.Fatalf("bob chat bucket: %v", err)
	}
	if bA.ObjectCount != 1 || bA.UsedBytes != int64(len(body)) {
		t.Errorf("alice usage: count=%d used=%d", bA.ObjectCount, bA.UsedBytes)
	}
	if bB.ObjectCount != 1 || bB.UsedBytes != int64(len(body)) {
		t.Errorf("bob usage: count=%d used=%d", bB.ObjectCount, bB.UsedBytes)
	}
}

// TestSaveFile_RejectsMissingActor — uploads without a JWT subject
// must be refused at the service entry. There is no anonymous
// upload code path.
func TestSaveFile_RejectsMissingActor(t *testing.T) {
	_, _, _, svc := newSvc(t, KeyStrategyRandom, "local")
	f, h := makePart(t, "anon.txt", []byte("nope"))
	_, err := svc.SaveFile(context.Background(), UploadAttribution{}, f, h)
	if !errors.Is(err, ErrActorRequired) {
		t.Fatalf("expected ErrActorRequired, got %v", err)
	}
}

// TestSaveFile_RejectsChatVisibilityWithoutSession — chat visibility
// without a chat_session_id is incoherent (audience cannot be
// determined). Reject at the service entry rather than persisting a
// row that no permission check can ever satisfy.
func TestSaveFile_RejectsChatVisibilityWithoutSession(t *testing.T) {
	_, _, _, svc := newSvc(t, KeyStrategyRandom, "local")
	f, h := makePart(t, "x.txt", []byte("nope"))
	attr := UploadAttribution{
		ActorID:    testActorA,
		BucketName: ossmodel.SystemBucketChat,
		Visibility: ossmodel.VisibilityChat,
	}
	_, err := svc.SaveFile(context.Background(), attr, f, h)
	if !errors.Is(err, ErrChatSessionRequired) {
		t.Fatalf("expected ErrChatSessionRequired, got %v", err)
	}
}

// TestSaveFile_RespectsBucketQuota — the chat bucket has a 5 GiB
// quota, but we set an artificial small quota and verify uploads
// past it surface ErrQuotaExceeded.
func TestSaveFile_RespectsBucketQuota(t *testing.T) {
	_, buckets, _, svc := newSvc(t, KeyStrategyRandom, "local")

	// Pre-create the actor's chat bucket with a tiny quota.
	if _, err := buckets.EnsureSystem(context.Background(), testActorA, ossmodel.SystemBucketSpec{
		Name:              ossmodel.SystemBucketChat,
		SystemKey:         ossmodel.SystemBucketChat,
		Kind:              ossmodel.BucketKindSystem,
		DefaultVisibility: ossmodel.VisibilityChat,
		QuotaBytes:        10,
	}); err != nil {
		t.Fatalf("seed bucket: %v", err)
	}

	f, h := makePart(t, "big.bin", []byte("more than ten bytes here"))
	_, err := svc.SaveFile(context.Background(), defaultAttr(testActorA), f, h)
	if !errors.Is(err, ossrepo.ErrQuotaExceeded) {
		t.Fatalf("expected ErrQuotaExceeded, got %v", err)
	}
}
