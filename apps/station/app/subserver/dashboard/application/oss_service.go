// Package application — OSSService is the dashboard-side application
// service for the `/oss/*` family of endpoints. It is a thin facade
// over the read-only OSSRepository: pagination defaults and input
// validation live here, but no business policy (the OSS subserver
// itself is the source of truth for OSS-side rules). Mutating
// operations (today: pin / unpin a peer station's federation key)
// pass through unchanged — the handler records the dashboard audit
// row alongside the call so it stays consistent with the
// `handleResetActorPassword`-style pattern used elsewhere.
package application

import (
	"context"
	"errors"
	"mime/multipart"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	ossservice "github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
)

// OSSService binds the dashboard handler layer to the OSS-facing
// repo. Construction is intentionally minimal so tests can wire a
// fake repo without a database.
//
// `fileService` is the cross-subserver hand-off used by the admin
// upload path (`POST /dashboard/api/oss/buckets/:id/upload`). It
// is intentionally optional — when the OSS subserver is not loaded
// (test harness, dashboard-only deployment) the upload endpoint
// surfaces a clean 503 instead of NPE'ing on the writer side.
type OSSService struct {
	repo        infrastructure.OSSRepository
	fileService ossservice.FileService
	maxFileSize int64
}

// NewOSSService builds an OSSService bound to the given repo.
// `fileService` and `maxFileSize` may be supplied later via
// `SetFileServiceProvider` once sibling subservers are resolved at
// `Start()` time.
func NewOSSService(repo infrastructure.OSSRepository) *OSSService {
	return &OSSService{repo: repo}
}

// FileServiceProvider mirrors the cross-package contract on the
// OSS subserver — kept here so the dashboard does not import
// `oss.FileServiceProvider` directly (avoids a forward dependency
// from `application` to a sibling subserver type). The dashboard's
// `Start()` performs the type assertion against the OSS subserver
// instance and forwards what it discovers.
type FileServiceProvider interface {
	FileService() ossservice.FileService
	MaxFileSize() int64
}

// SetFileServiceProvider plugs in the OSS subserver's `FileService`
// + max-upload budget. Calling with `nil` (or with a provider that
// returns a nil FileService) leaves the admin upload endpoint
// unconfigured — `AdminUploadObject` will then return
// `ErrAdminUploadUnavailable`.
func (s *OSSService) SetFileServiceProvider(p FileServiceProvider) {
	if p == nil {
		s.fileService = nil
		s.maxFileSize = 0
		return
	}
	s.fileService = p.FileService()
	s.maxFileSize = p.MaxFileSize()
}

// AdminUploadFileSize returns the upload-size budget the OSS
// subserver enforces. Zero when the FileService is not wired.
func (s *OSSService) AdminUploadFileSize() int64 { return s.maxFileSize }

// ---------------------------------------------------------------------------
// Read paths — direct delegation to the repo. Kept here (rather
// than letting the handler talk to the repo directly) so future
// per-admin scope checks have a single insertion point.
// ---------------------------------------------------------------------------

func (s *OSSService) ListBuckets(ctx context.Context) (*domain.OSSBucketListResponse, error) {
	rows, err := s.repo.ListBuckets(ctx)
	if err != nil {
		return nil, err
	}
	return &domain.OSSBucketListResponse{Items: rows, Total: len(rows)}, nil
}

func (s *OSSService) GetBucket(ctx context.Context, id string) (*domain.OSSBucketSummary, error) {
	if id == "" {
		return nil, errors.New("bucket id is required")
	}
	return s.repo.GetBucket(ctx, id)
}

func (s *OSSService) ListObjects(ctx context.Context, q infrastructure.OSSObjectQuery) (*domain.OSSObjectListResponse, error) {
	if q.PageSize <= 0 {
		q.PageSize = 50
	}
	rows, total, err := s.repo.ListObjects(ctx, q)
	if err != nil {
		return nil, err
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	return &domain.OSSObjectListResponse{Items: rows, Total: total, Page: page}, nil
}

func (s *OSSService) ListAudit(ctx context.Context, q infrastructure.OSSAuditQuery) (*domain.OSSAuditListResponse, error) {
	if q.PageSize <= 0 {
		q.PageSize = 50
	}
	rows, total, err := s.repo.ListAudit(ctx, q)
	if err != nil {
		return nil, err
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	return &domain.OSSAuditListResponse{Items: rows, Total: total, Page: page}, nil
}

func (s *OSSService) Usage(ctx context.Context) (*domain.OSSUsageSummary, error) {
	return s.repo.Usage(ctx)
}

func (s *OSSService) GetFederationLocal(ctx context.Context) (*domain.OSSFederationLocalKey, error) {
	return s.repo.GetFederationLocal(ctx)
}

func (s *OSSService) ListFederationPeers(ctx context.Context) (*domain.OSSFederationPeersResponse, error) {
	rows, err := s.repo.ListFederationPeers(ctx)
	if err != nil {
		return nil, err
	}
	return &domain.OSSFederationPeersResponse{Items: rows}, nil
}

// ---------------------------------------------------------------------------
// Mutating paths
// ---------------------------------------------------------------------------

// SetPeerPin is the operator-driven trust action: a pinned peer
// row freezes the kid, so a future silent rotation by the peer
// will be rejected at verify time. Unpinning falls back to TOFU
// semantics (still rejects mismatch in v1; future: re-TOFU).
func (s *OSSService) SetPeerPin(ctx context.Context, peerStationID string, pinned bool) error {
	if peerStationID == "" {
		return errors.New("peer_station_id is required")
	}
	return s.repo.SetPeerPin(ctx, peerStationID, pinned)
}

// ForgetPeer removes a peer's TOFU row entirely. The next inbound
// federated request from this peer will re-TOFU from scratch.
// Distinct from `SetPeerPin(..., false)` which only flips the
// pinned flag (the kid is preserved and a future key rotation
// would be silently accepted under unpinned-TOFU semantics).
func (s *OSSService) ForgetPeer(ctx context.Context, peerStationID string) error {
	if peerStationID == "" {
		return errors.New("peer_station_id is required")
	}
	return s.repo.ForgetPeer(ctx, peerStationID)
}

// ListWorkers returns the per-worker heartbeat projection over
// `oss_audit`. The default lookback is 24h; the handler can pass
// a different window for "show me last 7 days" UI flows. We reject
// negative lookbacks at this layer so the repo never has to
// re-validate.
func (s *OSSService) ListWorkers(ctx context.Context, lookback time.Duration) (*domain.OSSWorkersSummary, error) {
	if lookback < 0 {
		return nil, errors.New("lookback must be >= 0")
	}
	return s.repo.ListWorkers(ctx, lookback)
}

// ---------------------------------------------------------------------------
// Bucket lifecycle (admin)
// ---------------------------------------------------------------------------

// Visibility constants — duplicated here so we don't pull
// `oss/db/model` into the dashboard build (same rationale as the
// repo's hardcoded table names). Drift between these and the OSS
// subserver's `IsKnownVisibility` is caught by the repo layer
// receiving the value through gorm — invalid strings would either
// be rejected by a future CHECK constraint or surface as an OSS
// upload-time validation error.
const (
	visibilityPublic  = "public"
	visibilityChat    = "chat"
	visibilityPrivate = "private"
)

func isKnownVisibility(v string) bool {
	switch v {
	case visibilityPublic, visibilityChat, visibilityPrivate:
		return true
	}
	return false
}

// CreateBucket validates input and delegates to the repo. We
// reject empty fields, unknown visibilities and negative
// quotas/TTLs at this layer so the repo can stay schema-driven.
func (s *OSSService) CreateBucket(ctx context.Context, req domain.OSSBucketCreateRequest) (*domain.OSSBucketSummary, error) {
	owner := strings.TrimSpace(req.OwnerActorID)
	name := strings.TrimSpace(req.Name)
	if owner == "" {
		return nil, errors.New("owner_actor_id is required")
	}
	if name == "" {
		return nil, errors.New("name is required")
	}
	if len(name) > 120 {
		return nil, errors.New("name must be <= 120 characters")
	}
	vis := strings.TrimSpace(req.DefaultVisibility)
	if vis == "" {
		// Default to `private` — the safest fallback for an
		// admin-created bucket whose use-case is not yet
		// known. Operators who want public/chat must pass
		// the value explicitly.
		vis = visibilityPrivate
	}
	if !isKnownVisibility(vis) {
		return nil, errors.New("default_visibility must be one of: public, chat, private")
	}
	if req.QuotaBytes < 0 {
		return nil, errors.New("quota_bytes must be >= 0")
	}
	if req.TTLDays < 0 {
		return nil, errors.New("ttl_days must be >= 0")
	}
	return s.repo.CreateBucket(ctx, infrastructure.BucketCreateInput{
		OwnerActorID:      owner,
		Name:              name,
		DefaultVisibility: vis,
		QuotaBytes:        req.QuotaBytes,
		TTLDays:           req.TTLDays,
		Description:       strings.TrimSpace(req.Description),
	})
}

// UpdateBucket validates a partial mutate. Empty patches are
// rejected — the dashboard should not POST a no-op patch as a
// "save" action; clients that have nothing to change should not
// hit this endpoint at all.
func (s *OSSService) UpdateBucket(ctx context.Context, bucketID string, req domain.OSSBucketUpdateRequest) (*domain.OSSBucketSummary, error) {
	if bucketID == "" {
		return nil, errors.New("bucket id is required")
	}
	in := infrastructure.BucketUpdateInput{}
	if req.DefaultVisibility != nil {
		v := strings.TrimSpace(*req.DefaultVisibility)
		if !isKnownVisibility(v) {
			return nil, errors.New("default_visibility must be one of: public, chat, private")
		}
		in.DefaultVisibility = &v
	}
	if req.QuotaBytes != nil {
		if *req.QuotaBytes < 0 {
			return nil, errors.New("quota_bytes must be >= 0")
		}
		in.QuotaBytes = req.QuotaBytes
	}
	if req.TTLDays != nil {
		if *req.TTLDays < 0 {
			return nil, errors.New("ttl_days must be >= 0")
		}
		in.TTLDays = req.TTLDays
	}
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		if len(d) > 500 {
			return nil, errors.New("description must be <= 500 characters")
		}
		in.Description = &d
	}
	if in.DefaultVisibility == nil && in.QuotaBytes == nil && in.TTLDays == nil && in.Description == nil {
		return nil, errors.New("at least one field must be provided")
	}
	return s.repo.UpdateBucket(ctx, bucketID, in)
}

// DeleteBucket gates on the `force` flag exactly like the OSS
// subserver does: non-empty buckets refuse without force; system
// buckets refuse even with force.
func (s *OSSService) DeleteBucket(ctx context.Context, bucketID string, force bool) error {
	if bucketID == "" {
		return errors.New("bucket id is required")
	}
	return s.repo.DeleteBucket(ctx, bucketID, force)
}

// RecordOSSAudit forwards an admin-initiated audit row into
// `oss_audit`. Wraps the repo so handlers do not import the
// infrastructure package directly.
func (s *OSSService) RecordOSSAudit(ctx context.Context, evt infrastructure.OSSAuditAppend) error {
	return s.repo.RecordOSSAudit(ctx, evt)
}

// ---------------------------------------------------------------------------
// Object lifecycle (admin)
// ---------------------------------------------------------------------------

// GetObject returns the admin detail for one file by ID; nil
// when missing. The dashboard handler uses this for the lookup
// before audit emission so the row's owner / bucket are
// available even when the object has been soft-deleted.
func (s *OSSService) GetObject(ctx context.Context, id string) (*domain.OSSObjectAdminDetail, error) {
	if id == "" {
		return nil, errors.New("object id is required")
	}
	return s.repo.GetObject(ctx, id)
}

// AdminPatchObject applies a partial mutate driven by an
// operator. The translation from request → repo input is the
// place we encode the "empty string clears chat_session_id /
// clear_expires_at flag clears expires_at" conventions
// documented on the request DTO.
func (s *OSSService) AdminPatchObject(ctx context.Context, id string, req domain.OSSObjectAdminPatchRequest) (*domain.OSSObjectAdminDetail, error) {
	if id == "" {
		return nil, errors.New("object id is required")
	}
	in := infrastructure.AdminPatchObjectInput{}

	if req.Visibility != nil {
		v := strings.TrimSpace(*req.Visibility)
		if !isKnownVisibility(v) {
			return nil, errors.New("visibility must be one of: public, chat, private")
		}
		in.Visibility = &v
	}

	if req.ChatSessionID != nil {
		trimmed := strings.TrimSpace(*req.ChatSessionID)
		in.ChatSessionIDSet = true
		if trimmed == "" {
			in.ChatSessionID = nil // explicit clear
		} else {
			in.ChatSessionID = &trimmed
		}
	}

	switch {
	case req.ClearExpiresAt:
		// Operator wants the column NULLed regardless of
		// any value they may also have included.
		in.ExpiresAtSet = true
		in.ExpiresAt = nil
	case req.ExpiresAt != nil:
		in.ExpiresAtSet = true
		in.ExpiresAt = req.ExpiresAt
	}

	if in.Visibility == nil && !in.ChatSessionIDSet && !in.ExpiresAtSet {
		return nil, errors.New("at least one field must be provided")
	}
	return s.repo.AdminPatchObject(ctx, id, in)
}

// AdminDeleteObject soft-deletes a file by ID. The repo returns
// the (deleted) row alongside ErrFileAlreadyDeleted on idempotent
// re-deletes; we forward that to the handler so it can emit the
// `already_deleted` reason without an extra read.
func (s *OSSService) AdminDeleteObject(ctx context.Context, id string) (*domain.OSSObjectAdminDetail, error) {
	if id == "" {
		return nil, errors.New("object id is required")
	}
	return s.repo.AdminDeleteObject(ctx, id)
}

// ---------------------------------------------------------------------------
// Federation key rotation (admin)
// ---------------------------------------------------------------------------

// RotateFederationLocalKey provisions a new Ed25519 federation
// keypair for this station, demoting the existing one to the
// `_prev` slot for the dual-sign grace window. The handler is
// responsible for the dashboard audit row and the `oss_audit`
// `key_rotate` event. We do not gate on "rotation already in
// progress" — repeated rotations within the grace window simply
// shift the `_prev` slot forward, which is a safe (if unusual)
// operation since `_prev` is only consulted by the finalizer
// worker.
func (s *OSSService) RotateFederationLocalKey(ctx context.Context) (*domain.OSSFederationRotateResponse, error) {
	return s.repo.RotateFederationLocalKey(ctx)
}

// ---------------------------------------------------------------------------
// Admin upload (admin)
// ---------------------------------------------------------------------------

// ErrAdminUploadUnavailable is returned by `AdminUploadObject` when
// the OSS sibling subserver is not loaded (or has not exposed its
// `FileService` yet). The handler maps this to 503 so an operator
// running a cut-down deployment sees a clean error rather than a
// generic 500.
var ErrAdminUploadUnavailable = errors.New("oss admin upload is not available — oss subserver not wired")

// ErrAdminUploadBucketRequired is returned when the caller did
// not supply a bucket id. The handler ought to enforce this
// upstream too; we double-check here so the service contract is
// self-defending.
var ErrAdminUploadBucketRequired = errors.New("bucket id is required")

// AdminUploadInput carries the operator's intent for the
// dashboard's `POST /buckets/:id/upload` endpoint.
//
// Visibility, ChatSessionID and Filename are optional:
//
//   - Visibility: empty → inherit the bucket's `DefaultVisibility`
//     (the OSS service applies the same fallback for owner uploads,
//     so this keeps admin uploads behaviourally identical to a user
//     PUT against the same bucket).
//   - ChatSessionID: required iff resolved visibility is `chat`;
//     enforced server-side by the OSS service so we don't duplicate
//     the rule here.
//   - Filename: empty → use the multipart header's filename. Set
//     when the operator wants to override the on-disk display name.
type AdminUploadInput struct {
	BucketID      string
	Visibility    string
	ChatSessionID string
	Filename      string
	File          multipart.File
	Header        *multipart.FileHeader
}

// AdminUploadObject performs an operator-driven upload into the
// named bucket. The bucket's `OwnerActorID` is what the OSS
// FileService stamps on the resulting `oss_files` row — this is
// the architectural equivalent of "admin acted on behalf of the
// owner", which is the same model the existing
// `AdminPatchObject` / `AdminDeleteObject` paths use.
//
// We deliberately do NOT allow the operator to pin a different
// `actor_id` on the resulting row; doing so would let the
// dashboard exfiltrate uploads under a fake identity. If a
// future use-case needs that, it should be a separate audited
// endpoint with a distinct action code.
func (s *OSSService) AdminUploadObject(ctx context.Context, in AdminUploadInput) (*domain.OSSObjectAdminDetail, error) {
	if s.fileService == nil {
		return nil, ErrAdminUploadUnavailable
	}
	bucketID := strings.TrimSpace(in.BucketID)
	if bucketID == "" {
		return nil, ErrAdminUploadBucketRequired
	}
	if in.File == nil || in.Header == nil {
		return nil, errors.New("file and header are required")
	}

	bucket, err := s.repo.GetBucket(ctx, bucketID)
	if err != nil {
		return nil, err
	}
	if bucket == nil {
		return nil, errors.New("bucket not found")
	}
	if strings.TrimSpace(bucket.OwnerActorID) == "" {
		// System buckets have no owner — they are auto-provisioned
		// by the OSS subserver on first user write and the dashboard
		// should not be ginning up uploads against them under an
		// empty actor id (the file service would reject it anyway,
		// but the error message would be cryptic).
		return nil, errors.New("bucket has no owner_actor_id; system buckets are not eligible for admin upload")
	}

	visibility := strings.TrimSpace(in.Visibility)
	if visibility != "" && !isKnownVisibility(visibility) {
		return nil, errors.New("visibility must be one of: public, chat, private")
	}
	if visibility == "" {
		visibility = strings.TrimSpace(bucket.DefaultVisibility)
	}

	if in.Filename != "" {
		// Honor the operator's display-name override. We mutate a
		// local copy of the header so the underlying multipart
		// reader's housekeeping fields are preserved.
		hdr := *in.Header
		hdr.Filename = in.Filename
		in.Header = &hdr
	}

	attr := ossservice.UploadAttribution{
		ActorID:       bucket.OwnerActorID,
		BucketName:    bucket.Name,
		Visibility:    visibility,
		ChatSessionID: strings.TrimSpace(in.ChatSessionID),
	}
	meta, err := s.fileService.SaveFile(ctx, attr, in.File, in.Header)
	if err != nil {
		return nil, err
	}

	// Re-project the freshly created row through the dashboard's
	// admin-detail repo lookup so the response shape matches what
	// the operator sees on the rest of the Objects surface.
	if meta == nil || meta.ID == "" {
		return nil, errors.New("oss save returned an empty file meta")
	}
	row, err := s.repo.GetObject(ctx, meta.ID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errors.New("oss admin upload produced row but lookup found none")
	}
	return row, nil
}
