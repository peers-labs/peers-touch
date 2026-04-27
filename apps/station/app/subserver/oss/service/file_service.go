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
//   - `KeyStrategyRandom` (default): `YYYY/MM/DD/<rand>.<ext>`. Every
//     upload produces a new key — no deduplication, no
//     content-integrity guarantee.
//   - `KeyStrategyCAS`: `cas/<sha256[0:2]>/<sha256>.<ext>`. A given
//     actor uploading the same bytes twice gets back their own
//     existing row without re-saving. Two *different* actors
//     uploading the same bytes get two metadata rows over a single
//     shared blob on disk; uniqueness is enforced via the composite
//     `(owner_actor_id, key)` index.
//
// The strategy is per-server (set via `Options.KeyStrategy`); it is
// not switchable per request because that would create unbounded
// fan-out of equivalent metas pointing at the same bytes.
type KeyStrategy string

const (
	// KeyStrategyRandom assigns a fresh random key per upload.
	KeyStrategyRandom KeyStrategy = "random"
	// KeyStrategyCAS derives the key from sha256(content), enabling
	// per-actor dedup and shared on-disk storage.
	KeyStrategyCAS KeyStrategy = "cas"
)

// UploadAttribution is the WHO + WHERE + WHO-CAN-SEE envelope every
// upload-path call must carry. The service layer rejects any upload
// missing `ActorID`; there is no anonymous-upload code path.
//
// Resolution rules applied by the service:
//   - `ActorID`: required. Empty → ErrActorRequired.
//   - `BucketName`: optional. Empty → defaults to system bucket
//     `chat`. Names matching a `SystemBucketSpec` are auto-created
//     via `BucketRepository.EnsureSystem` on first use; other names
//     must already exist as a `kind=user` bucket owned by the actor.
//   - `Visibility`: optional. Empty → inherits the resolved bucket's
//     `DefaultVisibility`. Must be one of public/chat/private after
//     resolution; unknown values are rejected.
//   - `ChatSessionID`: required iff resolved `Visibility == "chat"`.
//     Empty in any other case.
type UploadAttribution struct {
	ActorID       string
	BucketName    string
	Visibility    string
	ChatSessionID string
}

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
// row. Idempotent — the same actor calling complete twice for an
// identical CAS upload gets the original row back.
type CompleteUploadRequest struct {
	Key         string
	Filename    string
	ContentType string
	Size        int64
	Sha256      string
}

// FileService is the application-layer entry point for everything
// the HTTP handlers need to do with object metadata + bytes. The
// multipart `SaveFile` and the `PrepareUpload` / `CompleteUpload`
// pair coexist intentionally: each is a complete data path for its
// size class, and switching between them is per-request, not
// per-server.
type FileService interface {
	SaveFile(ctx context.Context, attr UploadAttribution, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error)
	GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error)
	PrepareUpload(ctx context.Context, presigner storage.PresignedBackend, attr UploadAttribution, req PrepareUploadRequest, ttl time.Duration) (PrepareUploadResult, error)
	CompleteUpload(ctx context.Context, presigner storage.PresignedBackend, attr UploadAttribution, req CompleteUploadRequest) (*ossmodel.FileMeta, error)
}

// Service-layer errors. Wrapped with %w so handlers can errors.Is
// against them when translating to HTTP status codes.
var (
	// ErrActorRequired is returned when an upload arrives without
	// a JWT subject. Handlers translate to HTTP 401.
	ErrActorRequired = errors.New("oss: actor id is required for upload")
	// ErrBucketUnknown is returned when the requested bucket is
	// neither a system bucket nor an existing user bucket owned by
	// the actor. Handlers translate to HTTP 400.
	ErrBucketUnknown = errors.New("oss: requested bucket does not exist for this actor")
	// ErrInvalidVisibility is returned when the resolved visibility
	// is not one of public/chat/private. Handlers translate to 400.
	ErrInvalidVisibility = errors.New("oss: invalid visibility")
	// ErrChatSessionRequired is returned when visibility=chat and
	// the request did not supply a chat_session_id. Handlers
	// translate to HTTP 400.
	ErrChatSessionRequired = errors.New("oss: chat visibility requires chat_session_id")
	// ErrPresignUnsupported is returned when the active backend
	// does not implement `storage.PresignedBackend`. Handlers
	// translate to HTTP 501.
	ErrPresignUnsupported = errors.New("oss: active backend does not support presigned uploads")
	// ErrMimeBlocked is returned when the upload's MIME matches a
	// configured blocklist prefix. Handlers translate to HTTP 415
	// (Unsupported Media Type) and stamp `reason=mime_blocked` on
	// the audit row.
	ErrMimeBlocked = errors.New("oss: mime blocked by policy")
)

// Config is the dependency envelope for the file service. We
// switched from positional params to a Config struct in v3 because
// the parameter list outgrew readability — uploads now coordinate
// across `oss_files`, `oss_buckets`, *and* `oss_blobs`, plus a
// MIME-blocklist gate, plus a clock for testable expiry computation.
//
// Required: `Files`, `Buckets`, `Blobs`, `Backend`, `BackendName`.
// Optional: `Strategy` (defaults to random), `Clock` (defaults to
// time.Now), `MimeBlocklist` (empty disables the gate).
type Config struct {
	Files       ossrepo.FileRepository
	Buckets     ossrepo.BucketRepository
	Blobs       ossrepo.BlobRepository
	Backend     storage.Backend
	BackendName string
	Strategy    KeyStrategy

	// MimeBlocklist is the same prefix list the OSS subserver
	// publishes via `Options.MimeBlocklist`. Compared against the
	// detected MIME with `strings.HasPrefix`. Empty disables the
	// gate.
	MimeBlocklist []string

	// Clock is the time source used for `ExpiresAt` defaults and
	// `Restore` timestamps. Tests inject a controllable clock to
	// pin expiry to a known instant; production uses `time.Now`.
	Clock func() time.Time
}

type fileService struct {
	repo        ossrepo.FileRepository
	buckets     ossrepo.BucketRepository
	blobs       ossrepo.BlobRepository
	backend     storage.Backend
	backendName string
	strategy    KeyStrategy

	mimeBlocklist []string
	clock         func() time.Time
}

// NewFileService constructs the file service from a populated
// `Config`. Strategy defaults to `KeyStrategyRandom`, backend name
// defaults to `"local"`, and clock defaults to `time.Now`.
//
// Every collaborator that touches state (`Files`, `Buckets`,
// `Blobs`) is mandatory: there is no "service without a bucket
// repo" mode, because every successful upload must debit a bucket
// AND atomically maintain the blob ref_count.
func NewFileService(cfg Config) FileService {
	if cfg.Strategy == "" {
		cfg.Strategy = KeyStrategyRandom
	}
	if cfg.BackendName == "" {
		cfg.BackendName = "local"
	}
	if cfg.Clock == nil {
		cfg.Clock = time.Now
	}
	return &fileService{
		repo:          cfg.Files,
		buckets:       cfg.Buckets,
		blobs:         cfg.Blobs,
		backend:       cfg.Backend,
		backendName:   cfg.BackendName,
		strategy:      cfg.Strategy,
		mimeBlocklist: normaliseMimeBlocklist(cfg.MimeBlocklist),
		clock:         cfg.Clock,
	}
}

// resolved holds the post-validation state needed to write a
// FileMeta. We compute it once at the top of every upload-path
// method so the rest of the flow (Save / Create / AddUsage) can be
// invariant-respecting by construction.
type resolved struct {
	bucket     *ossmodel.Bucket
	visibility string
}

// resolveAttribution validates and normalises an UploadAttribution.
// It is the single place where (a) the bucket gets EnsureSystem'd,
// (b) the default visibility is materialised, and (c) the chat
// session requirement is checked. Every method in this file calls
// it exactly once before touching the backend.
func (s *fileService) resolveAttribution(ctx context.Context, attr UploadAttribution) (*resolved, error) {
	actor := strings.TrimSpace(attr.ActorID)
	if actor == "" {
		return nil, ErrActorRequired
	}
	bucketName := strings.TrimSpace(attr.BucketName)
	if bucketName == "" {
		bucketName = ossmodel.SystemBucketChat
	}

	var bucket *ossmodel.Bucket
	if spec := ossmodel.FindSystemBucketSpec(bucketName); spec != nil {
		b, err := s.buckets.EnsureSystem(ctx, actor, *spec)
		if err != nil {
			return nil, fmt.Errorf("oss: ensure system bucket %q: %w", bucketName, err)
		}
		bucket = b
	} else {
		b, err := s.buckets.FindByOwnerName(ctx, actor, bucketName)
		if err != nil {
			if errors.Is(err, ossrepo.ErrBucketNotFound) {
				return nil, fmt.Errorf("%w: %s", ErrBucketUnknown, bucketName)
			}
			return nil, err
		}
		bucket = b
	}

	vis := strings.TrimSpace(attr.Visibility)
	if vis == "" {
		vis = bucket.DefaultVisibility
	}
	if !ossmodel.IsKnownVisibility(vis) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidVisibility, vis)
	}
	if vis == ossmodel.VisibilityChat && strings.TrimSpace(attr.ChatSessionID) == "" {
		return nil, ErrChatSessionRequired
	}
	return &resolved{bucket: bucket, visibility: vis}, nil
}

func (s *fileService) SaveFile(ctx context.Context, attr UploadAttribution, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	res, err := s.resolveAttribution(ctx, attr)
	if err != nil {
		return nil, err
	}
	if s.strategy == KeyStrategyCAS {
		return s.saveCAS(ctx, attr, res, file, header)
	}
	return s.saveRandom(ctx, attr, res, file, header)
}

func (s *fileService) saveRandom(ctx context.Context, attr UploadAttribution, res *resolved, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	rnd, _ := touchutil.RandomString(16)
	ext := filepath.Ext(header.Filename)
	mt := detectMime(ext)
	if isBlockedMime(s.mimeBlocklist, mt) {
		return nil, fmt.Errorf("%w: %s", ErrMimeBlocked, mt)
	}
	now := s.clock()
	day := now.Format("2006/01/02")
	// Use forward slash explicitly for OSS keys to be cross-platform and URL friendly
	key := day + "/" + rnd + ext

	if err := s.buckets.AddUsage(ctx, res.bucket.ID, header.Size); err != nil {
		return nil, err
	}

	fullPath, err := s.backend.Save(ctx, key, file)
	if err != nil {
		_ = s.buckets.AddUsage(ctx, res.bucket.ID, -header.Size)
		return nil, err
	}

	if s.blobs != nil {
		if _, terr := s.blobs.Touch(ctx, s.backendName, key, header.Size, ""); terr != nil {
			_ = s.buckets.AddUsage(ctx, res.bucket.ID, -header.Size)
			_ = s.backend.Delete(ctx, key)
			return nil, terr
		}
	}

	meta := &ossmodel.FileMeta{
		ID:            rnd,
		Key:           key,
		Name:          header.Filename,
		Size:          header.Size,
		Mime:          mt,
		Backend:       s.backendName,
		Path:          fullPath,
		BucketID:      res.bucket.ID,
		OwnerActorID:  attr.ActorID,
		Visibility:    res.visibility,
		ChatSessionID: chatSessionForVisibility(attr.ChatSessionID, res.visibility),
		ExpiresAt:     defaultExpiresAt(now, res.bucket),
		CreatedAt:     now,
	}

	if err := s.repo.Create(ctx, meta); err != nil {
		// Random keys collide with vanishing probability; treat any
		// Create error as fatal and clean up the blob bytes.
		_ = s.buckets.AddUsage(ctx, res.bucket.ID, -header.Size)
		if s.blobs != nil {
			if _, dropped, _ := s.blobs.Release(ctx, s.backendName, key); dropped {
				_ = s.backend.Delete(ctx, key)
			}
		}
		return nil, err
	}
	return meta, nil
}

// saveCAS hashes the upload, derives a content-addressable key, and
// either:
//
//  1. Returns the *existing live* row owned by this actor (CAS
//     dedup short-circuit; bytes already on disk, blob already
//     refcounted) — the cheapest path.
//  2. Revives a soft-deleted row owned by this actor, by clearing
//     `DeletedAt`, bumping `UpdatedAt`, refreshing `ExpiresAt`
//     against the bucket's TTL, debiting the bucket usage, and
//     incrementing the blob's `RefCount` via `Touch`. Bytes are
//     already on disk; we do not re-`backend.Save`.
//  3. Performs a fresh upload: backend.Save, blobRepo.Touch,
//     bucket.AddUsage, repo.Create. On any failure after Save we
//     compensate by Release+AddUsage(-) so partial state never
//     ships.
//
// Two *different* actors uploading the same bytes share the blob
// on disk but each get their own metadata row so visibility and
// quota stay actor-scoped.
//
// We rely on `multipart.File` being seekable — Go's mime/multipart
// implementation keeps small parts in memory and spills large parts
// to a temp file, both of which are seekable.
func (s *fileService) saveCAS(ctx context.Context, attr UploadAttribution, res *resolved, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return nil, err
	}
	sum := hex.EncodeToString(h.Sum(nil))

	ext := strings.ToLower(filepath.Ext(header.Filename))
	key := casKey(sum, ext)
	mt := detectMime(ext)
	if isBlockedMime(s.mimeBlocklist, mt) {
		return nil, fmt.Errorf("%w: %s", ErrMimeBlocked, mt)
	}

	// Step 1: live CAS dedup — cheapest path. The bytes are already
	// counted under this actor's previous claim, so no usage debit.
	if existing, err := s.repo.FindByOwnerKey(ctx, attr.ActorID, key); err == nil && existing != nil && existing.Key == key {
		return existing, nil
	}

	// Step 2: revivable soft-deleted row? `IncludeDeleted` returns
	// the row regardless of DeletedAt; we branch on the column to
	// pick the revival path vs the fresh-upload path.
	if maybeDeleted, err := s.repo.FindByOwnerKeyIncludeDeleted(ctx, attr.ActorID, key); err == nil && maybeDeleted != nil && maybeDeleted.Key == key && maybeDeleted.DeletedAt != nil {
		return s.reviveCASRow(ctx, res, attr, maybeDeleted)
	}

	if err := s.buckets.AddUsage(ctx, res.bucket.ID, header.Size); err != nil {
		return nil, err
	}

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		_ = s.buckets.AddUsage(ctx, res.bucket.ID, -header.Size)
		return nil, err
	}
	fullPath, err := s.backend.Save(ctx, key, file)
	if err != nil {
		_ = s.buckets.AddUsage(ctx, res.bucket.ID, -header.Size)
		return nil, err
	}

	// Bytes are now on disk; the blob is "live" from the storage
	// backend's POV. Bump the refcount BEFORE inserting the meta
	// row so a crash between Save and Create still leaves the blob
	// observable to the reconciler.
	if s.blobs != nil {
		if _, terr := s.blobs.Touch(ctx, s.backendName, key, header.Size, sum); terr != nil {
			_ = s.buckets.AddUsage(ctx, res.bucket.ID, -header.Size)
			_ = s.backend.Delete(ctx, key)
			return nil, terr
		}
	}

	id, _ := touchutil.RandomString(16)
	now := s.clock()
	meta := &ossmodel.FileMeta{
		ID:            id,
		Key:           key,
		Name:          header.Filename,
		Size:          header.Size,
		Mime:          mt,
		Backend:       s.backendName,
		Path:          fullPath,
		Sha256:        sum,
		BucketID:      res.bucket.ID,
		OwnerActorID:  attr.ActorID,
		Visibility:    res.visibility,
		ChatSessionID: chatSessionForVisibility(attr.ChatSessionID, res.visibility),
		ExpiresAt:     defaultExpiresAt(now, res.bucket),
		CreatedAt:     now,
	}

	if err := s.repo.Create(ctx, meta); err != nil {
		// Most likely a (owner_actor_id, key) unique-index collision
		// from a concurrent upload by the same actor of the same
		// bytes. Roll back the usage debit + blob refcount and
		// return the winner.
		s.compensateAfterCreateFail(ctx, res.bucket.ID, key, header.Size)
		if existing, err2 := s.repo.FindByOwnerKey(ctx, attr.ActorID, key); err2 == nil && existing != nil && existing.Key == key {
			return existing, nil
		}
		return nil, err
	}
	return meta, nil
}

// reviveCASRow handles the "soft-deleted CAS hit" branch of
// saveCAS. The on-disk bytes are still there (the BlobGC worker
// has not run yet, by definition: the blob is either still ref'd
// elsewhere OR within its grace window). We:
//
//  1. Re-debit the bucket usage — we credited it on the matching
//     DELETE, so a fresh upload of the same bytes counts again.
//  2. Re-bump the blob ref_count via Touch — same observation as
//     (1) but for the physical-blob counter.
//  3. Clear `DeletedAt` and refresh `ExpiresAt` against the
//     current bucket TTL.
//
// Failures inside the revival path compensate symmetrically so the
// caller never observes a half-revived row.
func (s *fileService) reviveCASRow(ctx context.Context, res *resolved, attr UploadAttribution, row *ossmodel.FileMeta) (*ossmodel.FileMeta, error) {
	if err := s.buckets.AddUsage(ctx, res.bucket.ID, row.Size); err != nil {
		return nil, err
	}
	if s.blobs != nil {
		if _, terr := s.blobs.Touch(ctx, s.backendName, row.Key, row.Size, row.Sha256); terr != nil {
			_ = s.buckets.AddUsage(ctx, res.bucket.ID, -row.Size)
			return nil, terr
		}
	}
	now := s.clock()
	expiry := defaultExpiresAt(now, res.bucket)
	if err := s.repo.Restore(ctx, row.ID, now, expiry); err != nil {
		// Best-effort compensation. If Touch already incremented the
		// counter we leave it — the reconciler will catch any drift,
		// and the worst case is one extra ref that the next DELETE
		// will release.
		_ = s.buckets.AddUsage(ctx, res.bucket.ID, -row.Size)
		return nil, err
	}
	// Re-read so the caller sees the post-restore row state.
	out, err := s.repo.FindByOwnerKey(ctx, attr.ActorID, row.Key)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// compensateAfterCreateFail rolls back the side-effects taken
// between bucket.AddUsage and repo.Create on the fresh-upload path:
// the usage debit and the blob refcount bump. We do *not* call
// `backend.Delete` here — when Create fails on a duplicate
// (owner, key) the bytes are correct (some other concurrent upload
// won the race) and the blob refcount belongs to the winner. The
// reconciler will reconcile any drift.
func (s *fileService) compensateAfterCreateFail(ctx context.Context, bucketID, key string, size int64) {
	_ = s.buckets.AddUsage(ctx, bucketID, -size)
	if s.blobs != nil {
		_, _, _ = s.blobs.Release(ctx, s.backendName, key)
	}
}

// defaultExpiresAt returns now + bucket.TTLDays × 24h, or nil when
// the bucket has no TTL policy. The upload writer assigns the
// pointer directly into `oss_files.ExpiresAt`.
func defaultExpiresAt(now time.Time, bucket *ossmodel.Bucket) *time.Time {
	if bucket == nil || bucket.TTLDays <= 0 {
		return nil
	}
	t := now.Add(time.Duration(bucket.TTLDays) * 24 * time.Hour)
	return &t
}

// isBlockedMime returns true when `mt` matches any prefix in
// `blocklist`. Match is prefix-based and case-insensitive on both
// sides; the caller is responsible for already lowercasing the
// blocklist (NewFileService normalises).
func isBlockedMime(blocklist []string, mt string) bool {
	if len(blocklist) == 0 || mt == "" {
		return false
	}
	mt = strings.ToLower(mt)
	for _, p := range blocklist {
		if p == "" {
			continue
		}
		if strings.HasPrefix(mt, p) {
			return true
		}
	}
	return false
}

// normaliseMimeBlocklist trims, lowercases, and de-duplicates the
// configured prefix set so the upload hot path can compare without
// repeated allocations. Mirrors the helper of the same name in the
// `oss` package — duplicated here so the service has no dependency
// on its enclosing subserver package.
func normaliseMimeBlocklist(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			continue
		}
		if _, dup := seen[v]; dup {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// PrepareUpload opens a presigned upload session. CAS dedup
// short-circuits *before* any bucket usage is debited — the bytes
// are already on disk and already counted under the previous
// upload's row.
//
// The bucket is still resolved + validated here so the client gets
// a clean 4xx if the requested bucket / visibility is bogus,
// without having to round-trip a PUT first.
func (s *fileService) PrepareUpload(ctx context.Context, presigner storage.PresignedBackend, attr UploadAttribution, req PrepareUploadRequest, ttl time.Duration) (PrepareUploadResult, error) {
	if presigner == nil {
		return PrepareUploadResult{}, ErrPresignUnsupported
	}
	if req.Size <= 0 {
		return PrepareUploadResult{}, errors.New("oss: size is required for presigned upload")
	}
	if strings.TrimSpace(req.Filename) == "" {
		return PrepareUploadResult{}, errors.New("oss: filename is required for presigned upload")
	}

	res, err := s.resolveAttribution(ctx, attr)
	if err != nil {
		return PrepareUploadResult{}, err
	}

	ext := strings.ToLower(filepath.Ext(req.Filename))
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = detectMime(ext)
	}
	if isBlockedMime(s.mimeBlocklist, contentType) {
		return PrepareUploadResult{}, fmt.Errorf("%w: %s", ErrMimeBlocked, contentType)
	}

	var key string
	if s.strategy == KeyStrategyCAS {
		if !validSha256Hex(req.Sha256) {
			return PrepareUploadResult{}, errors.New("oss: cas strategy requires sha256 (64-char hex) on presigned upload")
		}
		key = casKey(req.Sha256, ext)
		if existing, err := s.repo.FindByOwnerKey(ctx, attr.ActorID, key); err == nil && existing != nil && existing.Key == key {
			return PrepareUploadResult{
				Meta:            existing,
				AlreadyUploaded: true,
			}, nil
		}
		// CAS revival on the presign path: matching the actor's
		// own SHA-256 against a soft-deleted row is by construction
		// safe — the bytes hash to the same key. We revive without
		// requiring the client to re-PUT.
		if maybeDeleted, err := s.repo.FindByOwnerKeyIncludeDeleted(ctx, attr.ActorID, key); err == nil && maybeDeleted != nil && maybeDeleted.Key == key && maybeDeleted.DeletedAt != nil {
			revived, rerr := s.reviveCASRow(ctx, res, attr, maybeDeleted)
			if rerr != nil {
				return PrepareUploadResult{}, rerr
			}
			return PrepareUploadResult{Meta: revived, AlreadyUploaded: true}, nil
		}
	} else {
		rnd, _ := touchutil.RandomString(16)
		day := s.clock().Format("2006/01/02")
		key = day + "/" + rnd + ext
	}

	pr, err := presigner.PresignPut(ctx, key, contentType, req.Size, req.Sha256, ttl)
	if err != nil {
		return PrepareUploadResult{}, fmt.Errorf("oss: presign put: %w", err)
	}

	return PrepareUploadResult{
		Meta: &ossmodel.FileMeta{
			Key:           key,
			Name:          req.Filename,
			Size:          req.Size,
			Mime:          contentType,
			Backend:       s.backendName,
			Sha256:        req.Sha256,
			BucketID:      res.bucket.ID,
			OwnerActorID:  attr.ActorID,
			Visibility:    res.visibility,
			ChatSessionID: chatSessionForVisibility(attr.ChatSessionID, res.visibility),
		},
		Method:    pr.Method,
		URL:       pr.URL,
		Headers:   pr.Headers,
		ExpiresAt: pr.ExpiresAt,
		MaxBytes:  pr.MaxBytes,
	}, nil
}

// CompleteUpload registers a successful presigned upload as a
// `FileMeta` row owned by `attr.ActorID`. The caller must already
// have PUT the bytes to the presigned URL. We `HeadObject` to
// confirm the bytes landed and the claimed size is honest, then
// debit the bucket and `Create`. Idempotent for the same (actor,
// key) tuple — a retried complete returns the original row.
func (s *fileService) CompleteUpload(ctx context.Context, presigner storage.PresignedBackend, attr UploadAttribution, req CompleteUploadRequest) (*ossmodel.FileMeta, error) {
	if presigner == nil {
		return nil, ErrPresignUnsupported
	}
	if strings.TrimSpace(req.Key) == "" {
		return nil, errors.New("oss: key is required for upload-complete")
	}

	res, err := s.resolveAttribution(ctx, attr)
	if err != nil {
		return nil, err
	}

	if existing, err := s.repo.FindByOwnerKey(ctx, attr.ActorID, req.Key); err == nil && existing != nil && existing.Key == req.Key {
		return existing, nil
	}
	// Tiny-race revival: a Delete may have raced between Prepare
	// and Complete and soft-deleted the row we'd otherwise return.
	// The bytes are still on disk, so revive symmetrically with
	// the multipart `saveCAS` path.
	if maybeDeleted, err := s.repo.FindByOwnerKeyIncludeDeleted(ctx, attr.ActorID, req.Key); err == nil && maybeDeleted != nil && maybeDeleted.Key == req.Key && maybeDeleted.DeletedAt != nil {
		return s.reviveCASRow(ctx, res, attr, maybeDeleted)
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

	mt := strings.TrimSpace(req.ContentType)
	if mt == "" {
		if head.Mime != "" {
			mt = head.Mime
		} else {
			mt = detectMime(strings.ToLower(filepath.Ext(req.Filename)))
		}
	}
	if isBlockedMime(s.mimeBlocklist, mt) {
		return nil, fmt.Errorf("%w: %s", ErrMimeBlocked, mt)
	}

	if err := s.buckets.AddUsage(ctx, res.bucket.ID, head.Size); err != nil {
		return nil, err
	}

	if s.blobs != nil {
		if _, terr := s.blobs.Touch(ctx, s.backendName, req.Key, head.Size, req.Sha256); terr != nil {
			_ = s.buckets.AddUsage(ctx, res.bucket.ID, -head.Size)
			return nil, terr
		}
	}

	id, _ := touchutil.RandomString(16)
	now := s.clock()
	meta := &ossmodel.FileMeta{
		ID:            id,
		Key:           req.Key,
		Name:          req.Filename,
		Size:          head.Size,
		Mime:          mt,
		Backend:       s.backendName,
		Path:          "", // S3 has no filesystem path; key is authoritative.
		Sha256:        req.Sha256,
		BucketID:      res.bucket.ID,
		OwnerActorID:  attr.ActorID,
		Visibility:    res.visibility,
		ChatSessionID: chatSessionForVisibility(attr.ChatSessionID, res.visibility),
		ExpiresAt:     defaultExpiresAt(now, res.bucket),
		CreatedAt:     now,
	}
	if err := s.repo.Create(ctx, meta); err != nil {
		// Concurrent winner of the same (actor, key) — return their
		// row and roll back the usage we just debited + the blob
		// refcount we bumped.
		s.compensateAfterCreateFail(ctx, res.bucket.ID, req.Key, head.Size)
		if existing, err2 := s.repo.FindByOwnerKey(ctx, attr.ActorID, req.Key); err2 == nil && existing != nil && existing.Key == req.Key {
			return existing, nil
		}
		return nil, err
	}
	return meta, nil
}

func (s *fileService) GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	return s.repo.FindByKey(ctx, key)
}

// chatSessionForVisibility returns the session id only when the
// resolved visibility is `chat`. For public/private rows the
// column is stored empty so audits and queries remain unambiguous.
func chatSessionForVisibility(sessionID, visibility string) string {
	if visibility == ossmodel.VisibilityChat {
		return strings.TrimSpace(sessionID)
	}
	return ""
}

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
