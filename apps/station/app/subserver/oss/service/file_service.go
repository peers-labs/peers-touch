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

	// DeleteFile soft-deletes the (owner, key) row, releases the
	// blob refcount, and debits the owning bucket's usage.
	// Idempotent: a re-DELETE of an already-deleted row returns
	// the current state without re-debiting. The caller is
	// responsible for verifying the subject owns the row before
	// calling.
	DeleteFile(ctx context.Context, ownerActorID, key string) (*DeleteResult, error)

	// RestoreFile reverses a soft delete that occurred within
	// `graceWindow`. Outside the window, returns
	// `ErrRestoreWindowExpired`; the row stays deleted and the
	// caller maps to 410 Gone. Atomicity guarantees:
	//   - the bucket re-debit is checked against quota; an over-
	//     quota restore returns ErrQuotaExceeded and rolls back;
	//   - blob refcount and bucket usage are rolled back if the
	//     `Restore` UPDATE fails after them.
	RestoreFile(ctx context.Context, ownerActorID, key string, graceWindow time.Duration) (*RestoreResult, error)

	// PatchFile applies an owner-only partial mutate. Each field
	// in `req` is optional; nil pointer = leave alone. The service
	// validates the (visibility, chat_session_id) coupling, performs
	// any cross-bucket move atomically (debit source, credit
	// target with quota check, rollback on failure), and bumps
	// `oss_meta(capability_version)` whenever the visibility is
	// tightened (`public→chat|private`, `chat→private`).
	PatchFile(ctx context.Context, ownerActorID, key string, req PatchRequest) (*PatchResult, error)

	// ListMyFiles returns a paginated, owner-scoped listing.
	//
	// Filters (all optional):
	//   - `BucketName`: system bucket name or user bucket name.
	//     Unknown bucket → empty result, NOT an error: the user
	//     simply has no files in that bucket.
	//   - `Visibility`: must be one of public/chat/private when
	//     non-empty; otherwise ErrInvalidVisibility.
	//   - `MimePrefix`: matched as `LIKE '<prefix>%'` against
	//     `oss_files.mime`.
	//   - `IncludeDeleted`: surface soft-deleted rows alongside
	//     live ones. The "trash" UI uses this; default reads do
	//     not.
	//
	// Pagination defaults match the doc: page=1, page_size=50,
	// page_size capped at 200. Out-of-range values are clamped
	// (silent) rather than rejected — the dashboard sometimes
	// posts the cap directly.
	//
	// No audit row is written: reading own metadata is by
	// definition allowed and the row's own `updated_at` is the
	// only signal the dashboard needs.
	ListMyFiles(ctx context.Context, ownerActorID string, req ListMyFilesRequest) (*ListMyFilesResult, error)
}

// AttachmentReader is the narrow cross-subserver contract for consuming an
// actor-owned object. The implementation resolves metadata by (owner, key)
// before opening bytes and enforces a caller-provided read bound.
type AttachmentReader interface {
	ReadOwnedFile(ctx context.Context, ownerActorID, key string, maxBytes uint64) (*ossmodel.FileMeta, []byte, error)
}

// DeleteResult is what the handler echoes back on a successful
// (or idempotent) DELETE. `AlreadyDeleted` is true when the row
// was already in the soft-delete state — the handler emits
// `reason=user_idempotent` on the audit row in that case and the
// HTTP response is still 200/204 because the *user-visible*
// outcome is the same.
type DeleteResult struct {
	Meta           *ossmodel.FileMeta
	AlreadyDeleted bool
}

// RestoreResult is what the handler returns on a successful
// restore. The meta reflects post-restore state with `DeletedAt`
// cleared and `ExpiresAt` re-defaulted from the bucket TTL.
type RestoreResult struct {
	Meta *ossmodel.FileMeta
}

// PatchRequest is the patch envelope from the HTTP layer. Each
// nil pointer means "leave unchanged"; non-nil pointers carry the
// new value. `ExpiresAtSet` is the explicit "clear vs leave
// alone" flag for `expires_at` because `*time.Time` cannot
// distinguish a NULL stamp from "untouched".
//
// `BucketName` is the *user-facing* identifier (system name like
// `chat`, or a future user-defined bucket name). The service
// resolves it to a `bucket_id` so the wire shape stays stable
// even if the on-disk uuid migrates.
type PatchRequest struct {
	Visibility    *string
	ChatSessionID *string
	BucketName    *string
	Filename      *string

	ExpiresAtSet bool
	ExpiresAt    *time.Time
}

// PatchResult is the post-PATCH state echoed back to the caller.
// `VisibilityTightened` lets the handler write a more specific
// audit reason and pin the response header
// `X-Capability-Version` to the freshly-minted value.
type PatchResult struct {
	Meta                *ossmodel.FileMeta
	VisibilityTightened bool
	CapabilityVersion   string
	// FieldsChanged is the set of audit-reason field tags emitted
	// in stable order — handlers fan it out into one audit row
	// per field so the dashboard can graph individual columns.
	FieldsChanged []string
}

// ListMyFilesRequest is the user-facing search envelope. The
// service translates the user-friendly `BucketName` to a
// `bucket_id` before hitting the repo so the wire shape stays
// stable even if the on-disk uuids migrate.
//
// Pagination is page-based (1-indexed). We deliberately exposed
// `page` rather than a raw cursor in v3 because the typical user
// has hundreds, not millions, of files and a familiar paginator
// is cheaper to render. Cursor pagination can be added later
// without breaking the wire shape.
type ListMyFilesRequest struct {
	BucketName     string
	Visibility     string
	MimePrefix     string
	IncludeDeleted bool

	Page     int
	PageSize int
}

// ListMyFilesResult is what the handler emits over the wire. The
// `Page` / `PageSize` fields reflect the *clamped* values applied
// at the service layer; this lets the client rebuild its
// paginator without having to second-guess the server's defaults.
type ListMyFilesResult struct {
	Files    []ossmodel.FileMeta
	Total    int64
	Page     int
	PageSize int
}

// MaxListMyFilesPageSize is the upper bound on `page_size`. The
// dashboard's table virtualises rendering above ~200 rows, so
// going higher would only enlarge response bodies without
// improving UX. Tested values stay in [1, 200].
const MaxListMyFilesPageSize = 200

// DefaultListMyFilesPageSize is the page size applied when the
// caller omits the parameter. 50 matches the dashboard's default
// table density.
const DefaultListMyFilesPageSize = 50

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
	// ErrFileNotFound is the service-layer mirror of the repo
	// sentinel; handlers map to HTTP 404. We re-export here so
	// handlers depend on the service package only.
	ErrFileNotFound = errors.New("oss: file not found")
	// ErrRestoreWindowExpired is returned by `RestoreFile` when the
	// soft-delete row's `DeletedAt` is older than the grace window.
	// Handlers map to HTTP 410 Gone with `reason=restore_window_expired`.
	ErrRestoreWindowExpired = errors.New("oss: soft-delete restore window expired")
	// ErrFileAlreadyLive is returned by `RestoreFile` when the row
	// exists but is not in the soft-delete state. Restore is
	// well-defined only on rows that were previously deleted; live
	// rows return this so the caller knows nothing was changed.
	ErrFileAlreadyLive = errors.New("oss: file is not in soft-delete state")
	// ErrEmptyPatch is returned by `PatchFile` when the caller did
	// not supply a single mutating field — keeping the row's
	// `updated_at` honest: PATCH is not a "touch" primitive.
	ErrEmptyPatch = errors.New("oss: patch must include at least one mutating field")
	// ErrPatchOnDeleted is returned when a PATCH targets a soft-
	// deleted row. The user must restore first; we deliberately do
	// NOT silently revive on PATCH because that would conflate two
	// distinct intents.
	ErrPatchOnDeleted = errors.New("oss: cannot patch a deleted file (restore first)")
	// ErrCrossActorBucket is returned by `PatchFile` when a bucket
	// move targets a bucket owned by another actor. Owners can
	// only re-organise their own buckets.
	ErrCrossActorBucket = errors.New("oss: cannot move file into a bucket owned by another actor")
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
	Meta        ossrepo.MetaRepository
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
	meta        ossrepo.MetaRepository
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
		meta:          cfg.Meta,
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
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return nil, err
	}
	sum := hex.EncodeToString(hasher.Sum(nil))
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}

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
		if _, terr := s.blobs.Touch(ctx, s.backendName, key, header.Size, sum); terr != nil {
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
		Sha256:        sum,
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

func (s *fileService) ReadOwnedFile(
	ctx context.Context,
	ownerActorID string,
	key string,
	maxBytes uint64,
) (*ossmodel.FileMeta, []byte, error) {
	owner := strings.TrimSpace(ownerActorID)
	key = strings.TrimSpace(key)
	if owner == "" {
		return nil, nil, ErrActorRequired
	}
	if key == "" || maxBytes == 0 {
		return nil, nil, errors.New("oss: bounded owner read requires key and max_bytes")
	}

	meta, err := s.repo.FindByOwnerKey(ctx, owner, key)
	if err != nil {
		return nil, nil, err
	}
	if meta == nil || meta.OwnerActorID != owner || meta.DeletedAt != nil {
		return nil, nil, ErrFileNotFound
	}
	if meta.Size < 0 || uint64(meta.Size) > maxBytes {
		return nil, nil, ossrepo.ErrQuotaExceeded
	}

	reader, _, _, err := s.backend.Open(ctx, key, nil)
	if err != nil {
		return nil, nil, err
	}
	defer reader.Close()

	body, err := io.ReadAll(io.LimitReader(reader, int64(maxBytes)+1))
	if err != nil {
		return nil, nil, err
	}
	if uint64(len(body)) > maxBytes || int64(len(body)) != meta.Size {
		return nil, nil, errors.New("oss: object body exceeds bound or size metadata")
	}
	return meta, body, nil
}

// DeleteFile is the owner-only soft-delete path. Ordering:
//
//  1. Resolve the live (owner, key) row. Missing → ErrFileNotFound;
//     already-deleted → idempotent return (AlreadyDeleted=true).
//  2. `MarkDeleted` flips `deleted_at = now` atomically; concurrent
//     deletes serialise on the row's UPDATE without a SELECT.
//  3. Best-effort bucket usage debit + blob refcount release.
//     A failure on these does NOT undo the soft delete — the
//     reconciler / blob GC corrects drift on the next pass. We
//     would rather be eventually-consistent than risk leaving the
//     row half-deleted from the user's POV.
func (s *fileService) DeleteFile(ctx context.Context, ownerActorID, key string) (*DeleteResult, error) {
	owner := strings.TrimSpace(ownerActorID)
	if owner == "" {
		return nil, ErrActorRequired
	}
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("oss: delete: key required")
	}

	row, err := s.repo.FindByOwnerKeyIncludeDeleted(ctx, owner, key)
	if err != nil || row == nil || row.Key != key {
		return nil, ErrFileNotFound
	}
	if row.DeletedAt != nil {
		// Idempotent: already deleted. We return the current row
		// so the handler can still write a useful audit line if
		// it wants to record the redundant call.
		return &DeleteResult{Meta: row, AlreadyDeleted: true}, nil
	}

	now := s.clock()
	if err := s.repo.MarkDeleted(ctx, row.ID, now); err != nil {
		// Concurrent delete won the race: surface as idempotent.
		if errors.Is(err, ossrepo.ErrFileAlreadyDeleted) {
			refreshed, ferr := s.repo.FindByOwnerKeyIncludeDeleted(ctx, owner, key)
			if ferr == nil && refreshed != nil {
				return &DeleteResult{Meta: refreshed, AlreadyDeleted: true}, nil
			}
		}
		return nil, err
	}

	// Best-effort accounting. Drift here is benign — the bucket
	// reconciler and BlobGC each have their own ground truth.
	if uerr := s.buckets.AddUsage(ctx, row.BucketID, -row.Size); uerr != nil {
		// Swallowed deliberately: the row IS deleted; the
		// reconciler will fix usage drift on the next sweep.
		_ = uerr
	}
	if s.blobs != nil {
		// Release does not delete the physical blob — that is
		// BlobGC's job after the grace window. We only decrement
		// the refcount here.
		_, _, _ = s.blobs.Release(ctx, s.backendName, row.Key)
	}

	// Reflect the post-delete state without an extra read by
	// patching the in-memory copy.
	deletedAt := now
	row.DeletedAt = &deletedAt
	row.UpdatedAt = now
	return &DeleteResult{Meta: row}, nil
}

// RestoreFile is the owner-only inverse of DeleteFile. It is
// allowed only within `graceWindow` of `DeletedAt`. The bucket
// re-debit is quota-checked; an over-quota restore returns
// ErrQuotaExceeded and rolls back so the row stays deleted.
//
// Restoring a never-deleted row returns ErrFileAlreadyLive — the
// handler maps to 409 Conflict so a client UI knows nothing happened
// (vs. 200 which would imply we touched the row).
func (s *fileService) RestoreFile(ctx context.Context, ownerActorID, key string, graceWindow time.Duration) (*RestoreResult, error) {
	owner := strings.TrimSpace(ownerActorID)
	if owner == "" {
		return nil, ErrActorRequired
	}
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("oss: restore: key required")
	}

	row, err := s.repo.FindByOwnerKeyIncludeDeleted(ctx, owner, key)
	if err != nil || row == nil || row.Key != key {
		return nil, ErrFileNotFound
	}
	if row.DeletedAt == nil {
		return nil, ErrFileAlreadyLive
	}
	now := s.clock()
	if graceWindow > 0 && now.Sub(*row.DeletedAt) > graceWindow {
		return nil, ErrRestoreWindowExpired
	}

	// Bucket lookup gives us TTL for re-defaulted ExpiresAt and
	// keeps the failure path clean: a missing bucket should never
	// happen post-create but if it does we abort before mutating
	// state.
	bucket, err := s.buckets.FindByID(ctx, row.BucketID)
	if err != nil {
		return nil, fmt.Errorf("oss: restore: bucket lookup: %w", err)
	}

	// Step 1: re-debit usage with quota check. If this fails we
	// have not touched anything else yet, so a clean error path.
	if err := s.buckets.AddUsage(ctx, row.BucketID, row.Size); err != nil {
		return nil, err
	}

	// Step 2: bump blob refcount. Compensate usage on failure.
	if s.blobs != nil {
		if _, terr := s.blobs.Touch(ctx, s.backendName, row.Key, row.Size, row.Sha256); terr != nil {
			_ = s.buckets.AddUsage(ctx, row.BucketID, -row.Size)
			return nil, terr
		}
	}

	// Step 3: clear deleted_at + refresh expires_at. Compensate
	// both prior steps on failure so partial state never ships.
	expiry := defaultExpiresAt(now, bucket)
	if err := s.repo.Restore(ctx, row.ID, now, expiry); err != nil {
		_ = s.buckets.AddUsage(ctx, row.BucketID, -row.Size)
		if s.blobs != nil {
			_, _, _ = s.blobs.Release(ctx, s.backendName, row.Key)
		}
		return nil, err
	}

	// Re-read so the caller observes the post-restore state.
	out, err := s.repo.FindByOwnerKey(ctx, owner, key)
	if err != nil || out == nil {
		// Should not happen — Restore just set the row live.
		// Surface the in-memory patched copy as a best effort.
		row.DeletedAt = nil
		row.ExpiresAt = expiry
		row.UpdatedAt = now
		return &RestoreResult{Meta: row}, nil
	}
	return &RestoreResult{Meta: out}, nil
}

// PatchFile is the owner-only partial mutate.
//
// Validation rules (the hard contract — clients depend on these):
//
//  1. Visibility must be one of public / chat / private.
//  2. If new visibility is `chat`, the row must have a non-empty
//     chat_session_id (either supplied in the patch or already
//     present on the row). For non-chat visibility, the
//     chat_session_id is unconditionally cleared so audits and
//     subsequent reads stay unambiguous.
//  3. Bucket moves are *same-actor only*: the destination bucket
//     must be owned by `ownerActorID`. Quota is checked atomically
//     on the destination, the source is debited, and any failure
//     rolls back fully.
//  4. ExpiresAt may be set, cleared, or extended; we do not enforce
//     monotonicity because the bucket TTL contract is "default at
//     create / restore", not "max lifetime".
//  5. Visibility tightening (public→{chat,private}, chat→private)
//     bumps `oss_meta(capability_version)` so remote caches
//     invalidate on next probe. Loosening does NOT bump.
//
// All-or-nothing: any validation or move failure leaves the row,
// blob refcount, and bucket usage untouched.
func (s *fileService) PatchFile(ctx context.Context, ownerActorID, key string, req PatchRequest) (*PatchResult, error) {
	owner := strings.TrimSpace(ownerActorID)
	if owner == "" {
		return nil, ErrActorRequired
	}
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("oss: patch: key required")
	}
	if !patchHasField(req) {
		return nil, ErrEmptyPatch
	}

	row, err := s.repo.FindByOwnerKeyIncludeDeleted(ctx, owner, key)
	if err != nil || row == nil || row.Key != key {
		return nil, ErrFileNotFound
	}
	if row.DeletedAt != nil {
		return nil, ErrPatchOnDeleted
	}

	// --- Stage 1: visibility + chat_session_id coupling ---------
	prevVis := row.Visibility
	newVis := prevVis
	if req.Visibility != nil {
		v := strings.ToLower(strings.TrimSpace(*req.Visibility))
		if !ossmodel.IsKnownVisibility(v) {
			return nil, ErrInvalidVisibility
		}
		newVis = v
	}

	// chat_session_id has three sources: explicit patch (req),
	// existing row, or "" (cleared). We compute the post-patch
	// value once so the audit set, repo writes, and validation all
	// agree.
	prevSession := row.ChatSessionID
	newSession := prevSession
	if req.ChatSessionID != nil {
		newSession = strings.TrimSpace(*req.ChatSessionID)
	}
	if newVis != ossmodel.VisibilityChat {
		// Non-chat visibility never carries a session id. Force-
		// clear so a subsequent visibility flip back to `chat` does
		// not silently inherit a stale session.
		newSession = ""
	} else if strings.TrimSpace(newSession) == "" {
		return nil, ErrChatSessionRequired
	}
	// --- Stage 2: bucket move (same-actor only) -----------------
	prevBucket := row.BucketID
	newBucket := prevBucket
	bucketRolledForward := false
	var destBucket *ossmodel.Bucket
	if req.BucketName != nil {
		destBucket, err = s.resolveBucketForOwner(ctx, owner, strings.TrimSpace(*req.BucketName))
		if err != nil {
			return nil, err
		}
		if destBucket.ID != prevBucket {
			// Atomic move: credit destination first (quota check),
			// then debit source. We compensate destination on a
			// failed source debit so we never partially commit.
			if err := s.buckets.AddUsage(ctx, destBucket.ID, row.Size); err != nil {
				return nil, err
			}
			if err := s.buckets.AddUsage(ctx, prevBucket, -row.Size); err != nil {
				_ = s.buckets.AddUsage(ctx, destBucket.ID, -row.Size)
				return nil, err
			}
			newBucket = destBucket.ID
			bucketRolledForward = true
		}
	}

	// --- Stage 3: capability_version bump (only on tightening) ---
	tightened := isVisibilityTighter(prevVis, newVis)
	capabilityVersion := ""
	if tightened && s.meta != nil {
		// Best-effort: a failure here does NOT block the patch.
		// The bootstrap path will re-seed on next start, and the
		// dashboard can manually re-roll. We swallow into a log
		// so the user-facing mutate stays atomic.
		v, verr := s.meta.SetCapabilityVersion(ctx, s.clock())
		if verr == nil {
			capabilityVersion = v
		}
	}

	// --- Stage 4: persist the patch -----------------------------
	now := s.clock()
	patch := ossrepo.FilePatch{}
	fields := make([]string, 0, 5)
	if req.Visibility != nil {
		v := newVis
		patch.Visibility = &v
		fields = append(fields, "visibility")
	}
	// Always persist the *resolved* chat_session_id when the
	// visibility flip changed it — even if the caller only
	// touched `visibility`, the coupling rule may have cleared
	// the session id.
	if newSession != prevSession || (req.ChatSessionID != nil) {
		s := newSession
		patch.ChatSessionID = &s
		if req.ChatSessionID != nil {
			fields = append(fields, "chat_session_id")
		}
	}
	if newBucket != prevBucket {
		b := newBucket
		patch.BucketID = &b
		fields = append(fields, "bucket")
	}
	if req.Filename != nil {
		f := strings.TrimSpace(*req.Filename)
		patch.Filename = &f
		fields = append(fields, "filename")
	}
	if req.ExpiresAtSet {
		patch.ExpiresAtSet = true
		patch.ExpiresAt = req.ExpiresAt
		fields = append(fields, "expires_at")
	}

	if err := s.repo.Patch(ctx, row.ID, patch, now); err != nil {
		// Patch failed — roll back any bucket move so we never
		// leave a row's bytes credited to the wrong bucket.
		if bucketRolledForward {
			_ = s.buckets.AddUsage(ctx, prevBucket, row.Size)
			_ = s.buckets.AddUsage(ctx, newBucket, -row.Size)
		}
		return nil, err
	}

	// Reflect post-patch state in the in-memory copy. We avoid a
	// second SELECT — the caller's audit + JSON response only
	// need the fields we already know we wrote.
	if patch.Visibility != nil {
		row.Visibility = *patch.Visibility
	}
	if patch.ChatSessionID != nil {
		row.ChatSessionID = *patch.ChatSessionID
	}
	if patch.BucketID != nil {
		row.BucketID = *patch.BucketID
	}
	if patch.Filename != nil {
		row.Name = *patch.Filename
	}
	if patch.ExpiresAtSet {
		row.ExpiresAt = patch.ExpiresAt
	}
	row.UpdatedAt = now

	return &PatchResult{
		Meta:                row,
		VisibilityTightened: tightened,
		CapabilityVersion:   capabilityVersion,
		FieldsChanged:       fields,
	}, nil
}

// ListMyFiles answers `GET /sub-oss/my-files`. See the interface
// docstring for filter / pagination semantics.
//
// Behaviour notes:
//
//   - Empty `ownerActorID` → ErrActorRequired (the handler 401s).
//   - Unknown `BucketName` → empty result with `Total=0`. We
//     deliberately do NOT return ErrBucketUnknown because the
//     intent ("list my files in bucket X") is consistent regardless
//     of whether the bucket has any rows yet.
//   - System bucket names that have not been EnsureSystem'd for
//     this actor also return empty: the listing path must not
//     create rows just to satisfy a query.
//   - `Visibility` non-empty must validate; otherwise
//     ErrInvalidVisibility (handler 400). Empty disables the filter.
//   - Pagination is silently clamped (Page≥1, 1≤PageSize≤200).
func (s *fileService) ListMyFiles(ctx context.Context, ownerActorID string, req ListMyFilesRequest) (*ListMyFilesResult, error) {
	owner := strings.TrimSpace(ownerActorID)
	if owner == "" {
		return nil, ErrActorRequired
	}

	page := req.Page
	if page < 1 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize < 1 {
		pageSize = DefaultListMyFilesPageSize
	}
	if pageSize > MaxListMyFilesPageSize {
		pageSize = MaxListMyFilesPageSize
	}

	visibility := strings.TrimSpace(req.Visibility)
	if visibility != "" {
		v := strings.ToLower(visibility)
		if !ossmodel.IsKnownVisibility(v) {
			return nil, fmt.Errorf("%w: %q", ErrInvalidVisibility, visibility)
		}
		visibility = v
	}

	filter := ossrepo.ListByOwnerFilter{
		Visibility:     visibility,
		MimePrefix:     strings.TrimSpace(req.MimePrefix),
		IncludeDeleted: req.IncludeDeleted,
	}

	// Resolve bucket name → id. Unknown bucket → empty result,
	// not an error. System buckets that the actor has never
	// touched also yield empty (we do NOT EnsureSystem here —
	// listing must be side-effect-free).
	bucketName := strings.TrimSpace(req.BucketName)
	if bucketName != "" {
		var bucketID string
		if spec := ossmodel.FindSystemBucketSpec(bucketName); spec != nil {
			b, err := s.buckets.FindByOwnerName(ctx, owner, spec.Name)
			if err != nil {
				if errors.Is(err, ossrepo.ErrBucketNotFound) {
					return &ListMyFilesResult{
						Files:    nil,
						Total:    0,
						Page:     page,
						PageSize: pageSize,
					}, nil
				}
				return nil, err
			}
			bucketID = b.ID
		} else {
			b, err := s.buckets.FindByOwnerName(ctx, owner, bucketName)
			if err != nil {
				if errors.Is(err, ossrepo.ErrBucketNotFound) {
					return &ListMyFilesResult{
						Files:    nil,
						Total:    0,
						Page:     page,
						PageSize: pageSize,
					}, nil
				}
				return nil, err
			}
			bucketID = b.ID
		}
		filter.BucketID = bucketID
	}

	offset := (page - 1) * pageSize
	rows, total, err := s.repo.ListByOwner(ctx, owner, filter, pageSize, offset)
	if err != nil {
		return nil, err
	}
	return &ListMyFilesResult{
		Files:    rows,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// resolveBucketForOwner returns the bucket row matching `(owner,
// bucketName)` — a system bucket gets `EnsureSystem`'d so a PATCH
// can move into a fresh actor-bound system bucket without a
// pre-flight upload. Cross-actor moves are rejected with
// ErrCrossActorBucket.
func (s *fileService) resolveBucketForOwner(ctx context.Context, owner, name string) (*ossmodel.Bucket, error) {
	if name == "" {
		return nil, ErrBucketUnknown
	}
	if spec := ossmodel.FindSystemBucketSpec(name); spec != nil {
		return s.buckets.EnsureSystem(ctx, owner, *spec)
	}
	b, err := s.buckets.FindByOwnerName(ctx, owner, name)
	if err != nil {
		return nil, ErrBucketUnknown
	}
	if b.OwnerActorID != owner {
		return nil, ErrCrossActorBucket
	}
	return b, nil
}

// isVisibilityTighter reports whether `next` is strictly tighter
// than `prev`. The ordering is `public > chat > private`, so any
// drop in that ordering counts as tightening.
func isVisibilityTighter(prev, next string) bool {
	rank := func(v string) int {
		switch v {
		case ossmodel.VisibilityPublic:
			return 2
		case ossmodel.VisibilityChat:
			return 1
		case ossmodel.VisibilityPrivate:
			return 0
		default:
			return -1
		}
	}
	return rank(next) < rank(prev) && rank(prev) >= 0 && rank(next) >= 0
}

// patchHasField reports whether the request mutates anything. Used
// to short-circuit empty PATCHes with ErrEmptyPatch before we hit
// the DB.
func patchHasField(req PatchRequest) bool {
	return req.Visibility != nil ||
		req.ChatSessionID != nil ||
		req.BucketName != nil ||
		req.Filename != nil ||
		req.ExpiresAtSet
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
