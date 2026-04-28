// Package infrastructure — OSSRepository surfaces read-only views of
// the OSS subserver's tables (oss_buckets, oss_files, oss_audit,
// oss_peer_keys, oss_meta) for the dashboard `/oss/*` endpoints.
//
// Why a dashboard-owned repo (rather than importing oss/db/repo)?
//   - Strict layering: the dashboard is a *presentation* layer; it
//     should consume schemas, not the OSS subserver's domain APIs.
//   - The dashboard projects fewer columns than the OSS service
//     does (no Path, no Sha256 in list views) — sharing the OSS
//     repo would push those projection rules into the wrong package.
//   - Pin/unpin actions on peer keys are operator-driven trust
//     decisions; they belong here next to the dashboard's audit
//     table writes, not next to the OSS upload/download paths.
package infrastructure

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base32"
	"encoding/pem"
	"errors"
	mathrand "math/rand"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
)

// Table names are intentionally hardcoded (matching ossmodel.TableName())
// so this repo does not import the OSS subserver model package and we
// do not couple dashboard build to OSS schema refactors.
const (
	tblOSSBuckets  = "oss_buckets"
	tblOSSFiles    = "oss_files"
	tblOSSAudit    = "oss_audit"
	tblOSSPeerKeys = "oss_peer_keys"
	tblOSSMeta     = "oss_meta"
)

const (
	metaKeyFedPriv      = "federation_priv_pem"
	metaKeyFedPub       = "federation_pub_pem"
	metaKeyFedKID       = "federation_kid"
	metaKeyFedPrivPrev  = "federation_priv_pem_prev"
	metaKeyFedKIDPrev   = "federation_kid_prev"
	metaKeyFedRotatedAt = "federation_rotated_at"
)

// OSSRepository is the dashboard-side view of the OSS subsystem.
// Reads dominate the surface; mutating methods are intentionally
// few and audit-bearing:
//
//   - SetPeerPin — trust commitment for federation peers.
//   - CreateBucket / UpdateBucket / DeleteBucket — operator-driven
//     bucket lifecycle. System buckets are NOT created or deleted
//     through this surface (see CreateBucket for rationale).
//   - RecordOSSAudit — append-only emit into oss_audit, used by
//     the bucket / object mutate paths so the change is captured
//     in the OSS audit log alongside the dashboard admin audit.
type OSSRepository interface {
	ListBuckets(ctx context.Context) ([]domain.OSSBucketSummary, error)
	GetBucket(ctx context.Context, bucketID string) (*domain.OSSBucketSummary, error)
	ListObjects(ctx context.Context, q OSSObjectQuery) ([]domain.OSSObjectSummary, int64, error)
	ListAudit(ctx context.Context, q OSSAuditQuery) ([]domain.OSSAuditEvent, int64, error)
	Usage(ctx context.Context) (*domain.OSSUsageSummary, error)

	GetFederationLocal(ctx context.Context) (*domain.OSSFederationLocalKey, error)
	ListFederationPeers(ctx context.Context) ([]domain.OSSFederationPeer, error)
	SetPeerPin(ctx context.Context, peerStationID string, pinned bool) error

	// ForgetPeer removes the peer's TOFU row entirely so the next
	// inbound request from this peer re-pairs from scratch. Pinned
	// peers can also be forgotten — the operator's intent here
	// ("I no longer trust *anything* about this peer") supersedes
	// the pin contract, which only applies to in-place key
	// rotations. Idempotent: forgetting a non-existent peer is
	// not an error (it is a no-op + zero rows affected).
	//
	// We do NOT bump capability_version here. The peer key cache
	// is *inbound* trust state; remote stations have their own
	// view of *us* and a forget on our side is invisible to them
	// (they will simply re-TOFU on their next request, which is
	// the desired outcome).
	ForgetPeer(ctx context.Context, peerStationID string) error

	// ListWorkers projects per-worker heartbeat rows from
	// `oss_audit` (action=`worker_run`) into a dashboard-shaped
	// summary. The reason column carries either the worker name
	// (success) or `<name>: <error>` (failure), so the projection
	// can recover the worker identity from a string match in
	// either branch. The lookback is bounded by the caller; the
	// default is 24h which matches the dashboard's "last day"
	// drill-down.
	//
	// We deliberately do NOT cross-call into the OSS subserver's
	// in-process Scheduler.Snapshot() from here: that view would
	// reset on every restart, which is misleading for a "is this
	// worker healthy?" panel. The audit table is the durable
	// source of truth — the in-process snapshot belongs in
	// /metrics for Prometheus.
	ListWorkers(ctx context.Context, lookback time.Duration) (*domain.OSSWorkersSummary, error)

	// CreateBucket inserts a new `user`-kind bucket. The
	// dashboard does NOT expose a Kind knob — system buckets
	// are auto-provisioned by the OSS subserver (see
	// `oss/db/repo/bucket_repo.EnsureSystem`); letting an
	// operator forge `kind=system` would give them a way to
	// shadow a canonical bucket spec.
	//
	// Returns ErrBucketExists when (owner, name) collides.
	CreateBucket(ctx context.Context, in BucketCreateInput) (*domain.OSSBucketSummary, error)

	// UpdateBucket applies a partial mutate. Each non-nil pointer
	// is set; nil pointers are left untouched. Returns
	// ErrBucketNotFound when the id is unknown.
	UpdateBucket(ctx context.Context, bucketID string, in BucketUpdateInput) (*domain.OSSBucketSummary, error)

	// DeleteBucket soft-deletes the bucket via gorm.DeletedAt.
	// Refuses non-empty buckets unless `force = true` — system
	// buckets are NEVER deletable, even with force, because the
	// upload path lazy-recreates them on next use which would
	// produce a confusing audit trail.
	DeleteBucket(ctx context.Context, bucketID string, force bool) error

	// RecordOSSAudit appends one row to oss_audit. Used by the
	// dashboard mutate handlers so admin-driven changes show up
	// in the OSS-side audit log with `dashboard_actor_id` set.
	// Errors are returned (caller logs) but never surface to the
	// user — auditing must not turn a successful mutation into
	// a 500.
	RecordOSSAudit(ctx context.Context, evt OSSAuditAppend) error

	// GetObject returns one file's projection by oss_files.id.
	// Returns nil when the row does not exist; the dashboard
	// admin paths need this lookup separately from ListObjects
	// because they address files by ULID, not (owner, key). The
	// projection includes soft-deleted rows so the admin UI can
	// inspect the lifecycle history; callers that want only-live
	// rows must filter on the returned `DeletedAt`.
	GetObject(ctx context.Context, id string) (*domain.OSSObjectAdminDetail, error)

	// AdminPatchObject applies an operator-driven mutate to the
	// file row identified by ID. Owner permission checks are
	// bypassed (this is the operator's intended escape hatch);
	// quota / bucket-move logic is NOT supported here — operators
	// who need to move a file across buckets should ask the owner
	// to use the user PATCH endpoint, since the cross-bucket
	// quota dance is owner-scoped by design.
	//
	// On visibility tightening (public → chat / private, or
	// chat → private) the repo bumps `oss_meta.capability_version`
	// in the same transaction as the file row update, mirroring
	// the user PATCH behaviour so remote caches invalidate.
	AdminPatchObject(ctx context.Context, id string, in AdminPatchObjectInput) (*domain.OSSObjectAdminDetail, error)

	// AdminDeleteObject soft-deletes the file row identified by
	// ID. Idempotent: a re-delete of an already-deleted row
	// returns ErrFileAlreadyDeleted (handler treats as 200 with
	// `already_deleted=true`).
	//
	// Bucket usage debit + blob refcount decrement are NOT
	// performed here; the BucketReconciler / BlobGC workers
	// (S11+) own ground-truth reconciliation, and doing the
	// debit synchronously from the dashboard would risk drift
	// between this path and the OSS subserver's own DeleteFile.
	AdminDeleteObject(ctx context.Context, id string) (*domain.OSSObjectAdminDetail, error)

	// RotateFederationLocalKey generates a fresh Ed25519 keypair
	// for this station's federation identity. The previous key
	// material is moved to the `*_prev` oss_meta slots and the
	// rotation timestamp is stamped — the KeyRotationFinalizer
	// worker (S12) clears `_prev` once the configured dual-sign
	// grace window has elapsed.
	//
	// The returned summary echoes the new KID and the bumped
	// `capability_version` so the dashboard UI can show "rotation
	// succeeded; peers will see a key change after their next
	// /capabilities refresh". Errors are returned verbatim — the
	// handler maps DB failures to 500.
	//
	// We deliberately do NOT call into the OSS subserver's
	// in-memory `federationKeyCache` from here: the cache reloads
	// on its own short TTL after every Get(). The dashboard owns
	// the storage; the OSS subserver owns the cache.
	RotateFederationLocalKey(ctx context.Context) (*domain.OSSFederationRotateResponse, error)
}

// OSSObjectQuery is the filter envelope for ListObjects.
type OSSObjectQuery struct {
	BucketID     string
	OwnerActorID string
	Visibility   string
	Mime         string
	Page         int
	PageSize     int
}

// OSSAuditQuery is the filter envelope for ListAudit.
type OSSAuditQuery struct {
	Action   string
	ActorID  string
	BucketID string
	FileKey  string
	Outcome  string
	Since    time.Time
	Until    time.Time
	Page     int
	PageSize int
}

// ErrPeerNotFound is returned by SetPeerPin when the requested
// peer_station_id has never federated. The handler maps it to 404.
var ErrPeerNotFound = errors.New("dashboard: oss: peer not found")

// Bucket-mutate errors. Mirror the OSS subserver's error set
// (oss/db/repo/bucket_repo.go) so dashboard callers get the same
// failure categories without having to import the OSS package.
var (
	ErrBucketNotFound  = errors.New("dashboard: oss: bucket not found")
	ErrBucketExists    = errors.New("dashboard: oss: bucket already exists")
	ErrBucketNotEmpty  = errors.New("dashboard: oss: bucket not empty (use force=true)")
	ErrBucketSystem    = errors.New("dashboard: oss: system buckets cannot be mutated")
	ErrBucketBadInput  = errors.New("dashboard: oss: bucket input invalid")
)

// Object admin-mutate errors. Closed set so handler error mapping
// is exhaustive without string sniffing.
var (
	ErrFileNotFound        = errors.New("dashboard: oss: file not found")
	ErrFileAlreadyDeleted  = errors.New("dashboard: oss: file already deleted")
	ErrFileBadInput        = errors.New("dashboard: oss: file input invalid")
	ErrFileChatNeedsSession = errors.New("dashboard: oss: chat visibility requires chat_session_id")
)

// BucketCreateInput is the repo-side envelope for CreateBucket. The
// service layer is responsible for filling sensible defaults; the
// repo only writes what it is given.
type BucketCreateInput struct {
	OwnerActorID      string
	Name              string
	DefaultVisibility string
	QuotaBytes        int64
	TTLDays           int32
	Description       string
}

// BucketUpdateInput is the repo-side envelope for UpdateBucket.
// Pointer-vs-nil is the explicit "set vs leave alone" signal —
// callers cannot use the zero value as a sentinel because zero is
// a legitimate target for several columns (TTLDays=0 = no TTL,
// Description="" = clear description).
type BucketUpdateInput struct {
	DefaultVisibility *string
	QuotaBytes        *int64
	TTLDays           *int32
	Description       *string
}

// AdminPatchObjectInput is the repo-side envelope for
// AdminPatchObject. Each pointer field is "set vs leave alone";
// `ChatSessionIDSet` is the explicit-clear flag (a nil
// `ChatSessionID` with `ChatSessionIDSet=true` means "clear it",
// matching the user PATCH path).
//
// `ExpiresAtSet` carries the same explicit-null semantics as the
// user PATCH endpoint: caller distinguishes "leave unchanged"
// from "clear the TTL".
type AdminPatchObjectInput struct {
	Visibility       *string
	ChatSessionID    *string
	ChatSessionIDSet bool
	ExpiresAt        *time.Time
	ExpiresAtSet     bool
}

// OSSAuditAppend is the value envelope for RecordOSSAudit. Mirrors
// the columns the dashboard cares about; the repo fills `ts` and
// any zero-valued primary key.
type OSSAuditAppend struct {
	Action           string
	BucketID         string
	FileKey          string
	FileID           string
	ActorID          string // file owner
	DashboardActorID string // operator who triggered the change
	SizeBytes        int64
	Outcome          string // "ok", "denied", "not_found", "error"
	Reason           string
	RequestID        string
}

type ossRepository struct {
	db *gorm.DB
}

// NewOSSRepository returns an OSSRepository bound to the shared
// *gorm.DB handle the dashboard already owns. No separate
// connection pool is created.
func NewOSSRepository(db *gorm.DB) OSSRepository {
	return &ossRepository{db: db}
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

func (r *ossRepository) ListBuckets(ctx context.Context) ([]domain.OSSBucketSummary, error) {
	if r.db == nil {
		return nil, nil
	}
	if !r.db.Migrator().HasTable(tblOSSBuckets) {
		return nil, nil
	}
	var rows []domain.OSSBucketSummary
	err := r.db.WithContext(ctx).Table(tblOSSBuckets).
		Select("id, name, owner_actor_id, kind, system_key, default_visibility, quota_bytes, used_bytes, ttl_days, description, created_at, updated_at").
		Where("deleted_at IS NULL").
		Order("created_at ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	// File counts in a separate query — this avoids a JOIN that
	// some sqlite versions over-eagerly serialise. It also lets
	// us skip the count entirely when oss_files is empty.
	if len(rows) > 0 && r.db.Migrator().HasTable(tblOSSFiles) {
		counts, err := r.bucketFileCounts(ctx)
		if err != nil {
			return nil, err
		}
		for i := range rows {
			rows[i].FileCount = counts[rows[i].ID]
		}
	}
	return rows, nil
}

func (r *ossRepository) GetBucket(ctx context.Context, bucketID string) (*domain.OSSBucketSummary, error) {
	if r.db == nil || bucketID == "" {
		return nil, nil
	}
	if !r.db.Migrator().HasTable(tblOSSBuckets) {
		return nil, nil
	}
	var row domain.OSSBucketSummary
	err := r.db.WithContext(ctx).Table(tblOSSBuckets).
		Select("id, name, owner_actor_id, kind, system_key, default_visibility, quota_bytes, used_bytes, ttl_days, description, created_at, updated_at").
		Where("id = ? AND deleted_at IS NULL", bucketID).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if r.db.Migrator().HasTable(tblOSSFiles) {
		var n int64
		if err := r.db.WithContext(ctx).Table(tblOSSFiles).
			Where("bucket_id = ?", bucketID).
			Count(&n).Error; err != nil {
			return nil, err
		}
		row.FileCount = n
	}
	return &row, nil
}

func (r *ossRepository) bucketFileCounts(ctx context.Context) (map[string]int64, error) {
	type row struct {
		BucketID string
		N        int64
	}
	var rows []row
	err := r.db.WithContext(ctx).Table(tblOSSFiles).
		Select("bucket_id, count(*) as n").
		Group("bucket_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.BucketID] = r.N
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

func (r *ossRepository) ListObjects(ctx context.Context, q OSSObjectQuery) ([]domain.OSSObjectSummary, int64, error) {
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSFiles) {
		return nil, 0, nil
	}
	tx := r.db.WithContext(ctx).Table(tblOSSFiles)
	if q.BucketID != "" {
		tx = tx.Where("bucket_id = ?", q.BucketID)
	}
	if q.OwnerActorID != "" {
		tx = tx.Where("owner_actor_id = ?", q.OwnerActorID)
	}
	if q.Visibility != "" {
		tx = tx.Where("visibility = ?", q.Visibility)
	}
	if q.Mime != "" {
		tx = tx.Where("mime = ?", q.Mime)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if q.PageSize > 0 {
		page := q.Page
		if page < 1 {
			page = 1
		}
		tx = tx.Offset((page - 1) * q.PageSize).Limit(q.PageSize)
	}

	var rows []domain.OSSObjectSummary
	err := tx.
		Select("id, key, name, size, mime, backend, bucket_id, owner_actor_id, visibility, chat_session_id, created_at").
		Order("created_at DESC").
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

func (r *ossRepository) ListAudit(ctx context.Context, q OSSAuditQuery) ([]domain.OSSAuditEvent, int64, error) {
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSAudit) {
		return nil, 0, nil
	}
	tx := r.db.WithContext(ctx).Table(tblOSSAudit)
	if q.Action != "" {
		tx = tx.Where("action = ?", q.Action)
	}
	if q.ActorID != "" {
		tx = tx.Where("actor_id = ?", q.ActorID)
	}
	if q.BucketID != "" {
		tx = tx.Where("bucket_id = ?", q.BucketID)
	}
	if q.FileKey != "" {
		tx = tx.Where("file_key = ?", q.FileKey)
	}
	if q.Outcome != "" {
		tx = tx.Where("outcome = ?", q.Outcome)
	}
	if !q.Since.IsZero() {
		tx = tx.Where("ts >= ?", q.Since)
	}
	if !q.Until.IsZero() {
		tx = tx.Where("ts <= ?", q.Until)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if q.PageSize > 0 {
		page := q.Page
		if page < 1 {
			page = 1
		}
		tx = tx.Offset((page - 1) * q.PageSize).Limit(q.PageSize)
	}

	var rows []domain.OSSAuditEvent
	err := tx.Order("ts DESC, id DESC").Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

func (r *ossRepository) Usage(ctx context.Context) (*domain.OSSUsageSummary, error) {
	if r.db == nil {
		return &domain.OSSUsageSummary{}, nil
	}
	out := &domain.OSSUsageSummary{}

	if r.db.Migrator().HasTable(tblOSSBuckets) {
		var n int64
		if err := r.db.WithContext(ctx).Table(tblOSSBuckets).Count(&n).Error; err != nil {
			return nil, err
		}
		out.BucketCount = int(n)
	}

	if r.db.Migrator().HasTable(tblOSSFiles) {
		type sumRow struct {
			TotalBytes int64
			TotalFiles int64
		}
		var s sumRow
		if err := r.db.WithContext(ctx).Table(tblOSSFiles).
			Select("coalesce(sum(size),0) as total_bytes, count(*) as total_files").
			Scan(&s).Error; err != nil {
			return nil, err
		}
		out.TotalBytes = s.TotalBytes
		out.TotalFiles = s.TotalFiles

		// Top-N owners — N is a UI-friendly small number. We sort
		// in Go after fetching (rather than relying on driver-
		// specific LIMIT semantics inside Group) so the behaviour
		// is identical across sqlite/postgres.
		type ownerRow struct {
			OwnerActorID string
			Bytes        int64
			Files        int64
		}
		var rows []ownerRow
		if err := r.db.WithContext(ctx).Table(tblOSSFiles).
			Select("owner_actor_id, coalesce(sum(size),0) as bytes, count(*) as files").
			Group("owner_actor_id").
			Find(&rows).Error; err != nil {
			return nil, err
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].Bytes > rows[j].Bytes })
		const topN = 10
		for i, r := range rows {
			if i >= topN {
				break
			}
			out.TopOwners = append(out.TopOwners, domain.OSSOwnerUsage{
				OwnerActorID: r.OwnerActorID, Bytes: r.Bytes, Files: r.Files,
			})
		}

		type visRow struct {
			Visibility string
			Bytes      int64
			Files      int64
		}
		var visRows []visRow
		if err := r.db.WithContext(ctx).Table(tblOSSFiles).
			Select("visibility, coalesce(sum(size),0) as bytes, count(*) as files").
			Group("visibility").
			Find(&visRows).Error; err != nil {
			return nil, err
		}
		for _, v := range visRows {
			out.VisibilityMix = append(out.VisibilityMix, domain.OSSVisibilityCount{
				Visibility: v.Visibility, Bytes: v.Bytes, Files: v.Files,
			})
		}
	}

	return out, nil
}

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

func (r *ossRepository) GetFederationLocal(ctx context.Context) (*domain.OSSFederationLocalKey, error) {
	out := &domain.OSSFederationLocalKey{}
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSMeta) {
		return out, nil
	}
	type kv struct{ Value string }
	var pubRow kv
	if err := r.db.WithContext(ctx).Table(tblOSSMeta).
		Select("value").
		Where("key = ?", metaKeyFedPub).
		Scan(&pubRow).Error; err != nil {
		return nil, err
	}
	var kidRow kv
	if err := r.db.WithContext(ctx).Table(tblOSSMeta).
		Select("value").
		Where("key = ?", metaKeyFedKID).
		Scan(&kidRow).Error; err != nil {
		return nil, err
	}
	out.PublicKeyPEM = pubRow.Value
	out.KID = kidRow.Value
	out.Generated = pubRow.Value != "" && kidRow.Value != ""
	return out, nil
}

func (r *ossRepository) ListFederationPeers(ctx context.Context) ([]domain.OSSFederationPeer, error) {
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSPeerKeys) {
		return nil, nil
	}
	var rows []domain.OSSFederationPeer
	err := r.db.WithContext(ctx).Table(tblOSSPeerKeys).
		Order("last_seen_at DESC").
		Find(&rows).Error
	return rows, err
}

func (r *ossRepository) SetPeerPin(ctx context.Context, peerStationID string, pinned bool) error {
	if r.db == nil || peerStationID == "" {
		return ErrPeerNotFound
	}
	if !r.db.Migrator().HasTable(tblOSSPeerKeys) {
		return ErrPeerNotFound
	}
	res := r.db.WithContext(ctx).Table(tblOSSPeerKeys).
		Where("peer_station_id = ?", peerStationID).
		Update("pinned", pinned)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrPeerNotFound
	}
	return nil
}

// ForgetPeer drops the entire row for `peerStationID`. Unlike
// `SetPeerPin(.., false)` which preserves the kid for re-pinning,
// this is a hard delete: the next inbound request from the peer
// will trigger a fresh TOFU. Idempotent — a missing row returns
// nil (no error) so the dashboard can offer a "forget" button
// without worrying about double-clicks.
func (r *ossRepository) ForgetPeer(ctx context.Context, peerStationID string) error {
	if r.db == nil || peerStationID == "" {
		return ErrPeerNotFound
	}
	if !r.db.Migrator().HasTable(tblOSSPeerKeys) {
		return ErrPeerNotFound
	}
	return r.db.WithContext(ctx).Table(tblOSSPeerKeys).
		Where("peer_station_id = ?", peerStationID).
		Delete(struct{}{}).Error
}

// ListWorkers projects worker_run rows from oss_audit into a
// per-worker summary. The implementation deliberately does its
// aggregation in two passes (one DB query, one Go-side reduce)
// rather than a single SQL GROUP BY:
//
//  1. Postgres + SQLite + MySQL all disagree about the syntax for
//     extracting the leading "<name>:" prefix from `reason` (the
//     error path) or distinguishing it from the success path
//     (where `reason == name`). A portable SQL aggregate would
//     need a dialect-specific case expression per backend.
//  2. The volume is bounded — even with 10 workers running every
//     hour, a 24h window is at most a few hundred rows. The
//     dashboard query rate is operator-driven (single-digit hits
//     per minute) so the I/O cost is negligible.
//
// The Go-side reduce is therefore both simpler and more portable.
func (r *ossRepository) ListWorkers(ctx context.Context, lookback time.Duration) (*domain.OSSWorkersSummary, error) {
	if lookback <= 0 {
		lookback = 24 * time.Hour
	}
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSAudit) {
		return &domain.OSSWorkersSummary{
			Items:         nil,
			LookbackHours: lookback.Hours(),
		}, nil
	}

	since := time.Now().Add(-lookback)
	type heartbeatRow struct {
		TS      time.Time `gorm:"column:ts"`
		Outcome string    `gorm:"column:outcome"`
		Reason  string    `gorm:"column:reason"`
	}
	var rows []heartbeatRow
	err := r.db.WithContext(ctx).Table(tblOSSAudit).
		Select("ts, outcome, reason").
		Where("action = ? AND ts >= ?", auditActionWorkerRun, since).
		Order("ts ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	// Reduce by worker name. The audit reason for a successful
	// run is the worker name verbatim; for an errored run it is
	// `<name>: <message...>` (truncated to 120 chars upstream).
	type acc struct {
		runs   int64
		errs   int64
		lastTS time.Time
		lastOK string
		lastEr string
	}
	bag := make(map[string]*acc)
	for _, row := range rows {
		name, errMsg := parseWorkerHeartbeatReason(row.Reason)
		if name == "" {
			continue
		}
		a, ok := bag[name]
		if !ok {
			a = &acc{}
			bag[name] = a
		}
		a.runs++
		if row.Outcome == auditOutcomeError {
			a.errs++
		}
		if row.TS.After(a.lastTS) {
			a.lastTS = row.TS
			a.lastOK = row.Outcome
			a.lastEr = errMsg
		}
	}

	out := make([]domain.OSSWorkerHeartbeat, 0, len(bag))
	for name, a := range bag {
		hb := domain.OSSWorkerHeartbeat{
			Name:        name,
			LastRunAt:   a.lastTS,
			LastOutcome: a.lastOK,
			RunCount:    a.runs,
			ErrorCount:  a.errs,
		}
		if hb.LastOutcome == auditOutcomeError {
			hb.LastError = a.lastEr
		}
		out = append(out, hb)
	}
	// Stable order keeps the dashboard panel from flickering as
	// the underlying map iteration is randomised per request.
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })

	return &domain.OSSWorkersSummary{
		Items:         out,
		LookbackHours: lookback.Hours(),
	}, nil
}

// parseWorkerHeartbeatReason recovers the worker name (and, when
// present, the error message) from a `worker_run` reason string.
// The scheduler upstream writes either `<name>` (success) or
// `<name>: <truncated error>` (failure). We split on the *first*
// `: ` so error messages that happen to contain a colon are
// preserved verbatim.
func parseWorkerHeartbeatReason(reason string) (name, errMsg string) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "", ""
	}
	if idx := strings.Index(reason, ": "); idx > 0 {
		return reason[:idx], strings.TrimSpace(reason[idx+2:])
	}
	return reason, ""
}

// auditActionWorkerRun + auditOutcomeError are duplicated here so
// the dashboard repo does not import the OSS subserver's audit
// model. They MUST stay in sync with `ossmodel.AuditActionWorkerRun`
// and `ossmodel.AuditOutcomeError`; a drift would silently cause
// the workers projection to return zero rows.
const (
	auditActionWorkerRun = "worker_run"
	auditOutcomeError    = "error"
)

// ---------------------------------------------------------------------------
// Bucket lifecycle (admin)
// ---------------------------------------------------------------------------

const (
	bucketKindUser   = "user"
	bucketKindSystem = "system"
)

// bucketRow is the on-disk shape we read/write through gorm. We
// duplicate the OSS subserver's `Bucket` struct here (rather than
// importing it) so the dashboard module stays decoupled from the
// OSS subserver's internal types — see the package doc-comment on
// `oss_repo.go`.
type bucketRow struct {
	ID                string         `gorm:"primaryKey;column:id"`
	Name              string         `gorm:"column:name"`
	OwnerActorID      string         `gorm:"column:owner_actor_id"`
	Kind              string         `gorm:"column:kind"`
	SystemKey         string         `gorm:"column:system_key"`
	DefaultVisibility string         `gorm:"column:default_visibility"`
	QuotaBytes        int64          `gorm:"column:quota_bytes"`
	UsedBytes         int64          `gorm:"column:used_bytes"`
	ObjectCount       int64          `gorm:"column:object_count"`
	TTLDays           int32          `gorm:"column:ttl_days"`
	Description       string         `gorm:"column:description"`
	CreatedAt         time.Time      `gorm:"column:created_at"`
	UpdatedAt         time.Time      `gorm:"column:updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (bucketRow) TableName() string { return tblOSSBuckets }

func (r *ossRepository) CreateBucket(ctx context.Context, in BucketCreateInput) (*domain.OSSBucketSummary, error) {
	if r.db == nil {
		return nil, ErrBucketBadInput
	}
	owner := strings.TrimSpace(in.OwnerActorID)
	name := strings.TrimSpace(in.Name)
	if owner == "" || name == "" {
		return nil, ErrBucketBadInput
	}
	if !r.db.Migrator().HasTable(tblOSSBuckets) {
		// Schema not bootstrapped; refuse rather than autocreate
		// because we'd be racing the OSS subserver's own
		// `Bootstrap` migration.
		return nil, ErrBucketBadInput
	}
	now := time.Now()
	row := bucketRow{
		ID:                newDashboardULID(now),
		Name:              name,
		OwnerActorID:      owner,
		Kind:              bucketKindUser,
		DefaultVisibility: in.DefaultVisibility,
		QuotaBytes:        in.QuotaBytes,
		TTLDays:           in.TTLDays,
		Description:       in.Description,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		if isUniqueViolationDashboard(err) {
			return nil, ErrBucketExists
		}
		return nil, err
	}
	return r.GetBucket(ctx, row.ID)
}

func (r *ossRepository) UpdateBucket(ctx context.Context, bucketID string, in BucketUpdateInput) (*domain.OSSBucketSummary, error) {
	if r.db == nil || bucketID == "" {
		return nil, ErrBucketNotFound
	}
	if !r.db.Migrator().HasTable(tblOSSBuckets) {
		return nil, ErrBucketNotFound
	}

	updates := map[string]any{"updated_at": time.Now()}
	if in.DefaultVisibility != nil {
		updates["default_visibility"] = *in.DefaultVisibility
	}
	if in.QuotaBytes != nil {
		updates["quota_bytes"] = *in.QuotaBytes
	}
	if in.TTLDays != nil {
		updates["ttl_days"] = *in.TTLDays
	}
	if in.Description != nil {
		updates["description"] = *in.Description
	}
	// updated_at alone is a no-op patch — refuse so callers can
	// catch "did you forget to set anything?" at the boundary.
	if len(updates) == 1 {
		return nil, ErrBucketBadInput
	}

	res := r.db.WithContext(ctx).Table(tblOSSBuckets).
		Where("id = ?", bucketID).
		Updates(updates)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrBucketNotFound
	}
	return r.GetBucket(ctx, bucketID)
}

func (r *ossRepository) DeleteBucket(ctx context.Context, bucketID string, force bool) error {
	if r.db == nil || bucketID == "" {
		return ErrBucketNotFound
	}
	if !r.db.Migrator().HasTable(tblOSSBuckets) {
		return ErrBucketNotFound
	}
	var row bucketRow
	if err := r.db.WithContext(ctx).Where("id = ?", bucketID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrBucketNotFound
		}
		return err
	}
	if row.Kind == bucketKindSystem {
		return ErrBucketSystem
	}
	if !force && row.ObjectCount > 0 {
		return ErrBucketNotEmpty
	}
	res := r.db.WithContext(ctx).Where("id = ?", bucketID).Delete(&bucketRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrBucketNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Object lifecycle (admin)
// ---------------------------------------------------------------------------

// fileRow mirrors ossmodel.FileMeta's column shape — same
// duplicate-rather-than-import rationale as bucketRow / auditRow.
// Only the columns the dashboard reads or writes are listed.
type fileRow struct {
	ID            string     `gorm:"primaryKey;column:id"`
	Key           string     `gorm:"column:key"`
	Name          string     `gorm:"column:name"`
	Size          int64      `gorm:"column:size"`
	Mime          string     `gorm:"column:mime"`
	Backend       string     `gorm:"column:backend"`
	BucketID      string     `gorm:"column:bucket_id"`
	OwnerActorID  string     `gorm:"column:owner_actor_id"`
	Visibility    string     `gorm:"column:visibility"`
	ChatSessionID string     `gorm:"column:chat_session_id"`
	Sha256        string     `gorm:"column:sha256"`
	ExpiresAt     *time.Time `gorm:"column:expires_at"`
	DeletedAt     *time.Time `gorm:"column:deleted_at"`
	CreatedAt     time.Time  `gorm:"column:created_at"`
	UpdatedAt     time.Time  `gorm:"column:updated_at"`
}

func (fileRow) TableName() string { return tblOSSFiles }

func toAdminDetail(r *fileRow) *domain.OSSObjectAdminDetail {
	if r == nil {
		return nil
	}
	return &domain.OSSObjectAdminDetail{
		ID:            r.ID,
		Key:           r.Key,
		Name:          r.Name,
		Size:          r.Size,
		Mime:          r.Mime,
		Backend:       r.Backend,
		BucketID:      r.BucketID,
		OwnerActorID:  r.OwnerActorID,
		Visibility:    r.Visibility,
		ChatSessionID: r.ChatSessionID,
		Sha256:        r.Sha256,
		ExpiresAt:     r.ExpiresAt,
		DeletedAt:     r.DeletedAt,
		CreatedAt:     r.CreatedAt,
		UpdatedAt:     r.UpdatedAt,
	}
}

func (r *ossRepository) GetObject(ctx context.Context, id string) (*domain.OSSObjectAdminDetail, error) {
	if r.db == nil || id == "" {
		return nil, nil
	}
	if !r.db.Migrator().HasTable(tblOSSFiles) {
		return nil, nil
	}
	var row fileRow
	err := r.db.WithContext(ctx).
		Where("id = ?", id).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return toAdminDetail(&row), nil
}

func (r *ossRepository) AdminPatchObject(ctx context.Context, id string, in AdminPatchObjectInput) (*domain.OSSObjectAdminDetail, error) {
	if r.db == nil || id == "" {
		return nil, ErrFileNotFound
	}
	if !r.db.Migrator().HasTable(tblOSSFiles) {
		return nil, ErrFileNotFound
	}

	var row fileRow
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFileNotFound
		}
		return nil, err
	}
	if row.DeletedAt != nil {
		// Patching a deleted row would let admins resurrect
		// state without going through the (audit-bearing)
		// restore path. Refuse.
		return nil, ErrFileAlreadyDeleted
	}

	updates := map[string]any{"updated_at": time.Now()}
	prevVis := row.Visibility
	newVis := prevVis

	if in.Visibility != nil {
		v := strings.TrimSpace(*in.Visibility)
		if v != visibilityPublicConst && v != visibilityChatConst && v != visibilityPrivateConst {
			return nil, ErrFileBadInput
		}
		newVis = v
		updates["visibility"] = v
	}

	// Couple chat_session_id with the post-patch visibility so the
	// row's invariant "chat ⇒ has session_id" cannot be broken
	// from the admin path either.
	postSession := row.ChatSessionID
	if in.ChatSessionIDSet {
		if in.ChatSessionID == nil {
			postSession = ""
		} else {
			postSession = strings.TrimSpace(*in.ChatSessionID)
		}
		updates["chat_session_id"] = postSession
	}
	if newVis == visibilityChatConst && postSession == "" {
		return nil, ErrFileChatNeedsSession
	}
	if newVis != visibilityChatConst && postSession != "" {
		// Tightening / changing visibility away from chat must
		// clear the session id even if the patch did not say
		// so explicitly — otherwise audits would lie.
		updates["chat_session_id"] = ""
	}

	if in.ExpiresAtSet {
		if in.ExpiresAt == nil {
			updates["expires_at"] = nil
		} else {
			updates["expires_at"] = *in.ExpiresAt
		}
	}

	if len(updates) == 1 {
		// Only updated_at. Refuse so callers see the no-op as
		// a 400 rather than a silently-successful save.
		return nil, ErrFileBadInput
	}

	res := r.db.WithContext(ctx).Table(tblOSSFiles).Where("id = ?", id).Updates(updates)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		// Lost a race with a delete or a concurrent admin
		// mutate that flipped deleted_at.
		return nil, ErrFileNotFound
	}

	// Visibility tightening bumps capability_version so remote
	// caches re-read the new policy. Loosening does NOT bump —
	// permissive moves are observable to clients on the next
	// access without invalidation. We do this AFTER the file
	// update so a failure here is not silently masking a
	// successful policy mutation.
	if visibilityIsTightening(prevVis, newVis) {
		if err := r.bumpCapabilityVersion(ctx); err != nil {
			// Log-and-continue would be wrong: the cache will
			// happily serve a stale policy. Surface as a 500
			// so the operator retries.
			return nil, err
		}
	}

	return r.GetObject(ctx, id)
}

func (r *ossRepository) AdminDeleteObject(ctx context.Context, id string) (*domain.OSSObjectAdminDetail, error) {
	if r.db == nil || id == "" {
		return nil, ErrFileNotFound
	}
	if !r.db.Migrator().HasTable(tblOSSFiles) {
		return nil, ErrFileNotFound
	}

	var row fileRow
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFileNotFound
		}
		return nil, err
	}
	if row.DeletedAt != nil {
		// Idempotent return: caller treats as "already done"
		// and emits an audit row with reason="already_deleted".
		return toAdminDetail(&row), ErrFileAlreadyDeleted
	}
	now := time.Now()
	res := r.db.WithContext(ctx).Table(tblOSSFiles).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(map[string]any{
			"deleted_at": now,
			"updated_at": now,
		})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		// Lost the race to a concurrent delete.
		return nil, ErrFileAlreadyDeleted
	}
	row.DeletedAt = &now
	row.UpdatedAt = now
	return toAdminDetail(&row), nil
}

// RotateFederationLocalKey replaces the station's outbound
// federation keypair with a freshly generated Ed25519 pair, while
// preserving the previous one in the `_prev` slots so peers that
// have cached our pubkey can verify in-flight tokens for the
// dual-sign grace window. Workflow:
//
//  1. Read the current (priv, pub, kid). When none exists yet
//     (greenfield install) we still mint a new pair and skip the
//     `_prev` writes so the first rotation acts like an initial
//     provision.
//  2. Generate a fresh Ed25519 keypair and re-derive its KID.
//  3. In a single write batch, copy the current priv+kid into the
//     `_prev` slots (when they exist), persist the new keypair as
//     the canonical slots, stamp `federation_rotated_at`, and bump
//     `capability_version` so peers re-fetch on their next refresh.
//
// Returns the new KID, the previous KID (empty on greenfield), the
// rotation timestamp, and the bumped capability_version. Errors
// are returned verbatim — callers are responsible for surfacing
// them as 5xx and recording an admin audit.
func (r *ossRepository) RotateFederationLocalKey(ctx context.Context) (*domain.OSSFederationRotateResponse, error) {
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSMeta) {
		return nil, errors.New("oss meta table not available")
	}

	// 1. Read current keypair via the meta table. Missing rows
	//    are not errors; they signal a fresh deployment.
	prevPriv, err := r.readMetaValue(ctx, metaKeyFedPriv)
	if err != nil {
		return nil, err
	}
	prevKID, err := r.readMetaValue(ctx, metaKeyFedKID)
	if err != nil {
		return nil, err
	}

	// 2. Mint a fresh keypair. Failure here aborts before we
	//    touch any storage so a partial rotation cannot wedge
	//    the federation key cache.
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	privPEM, pubPEM, kid, err := encodeFederationKeyForRotation(priv, pub)
	if err != nil {
		return nil, err
	}
	if kid == prevKID {
		// Astronomically unlikely (256-bit collision) but we
		// refuse rather than silently roll the same kid back
		// into place — a re-roll would be confusing in audit.
		return nil, errors.New("oss: federation: rotation produced identical kid; retry")
	}

	now := time.Now()
	rotatedAt := now.UTC()
	rotatedAtStr := rotatedAt.Format(time.RFC3339Nano)

	// 3. Persist the new state. We do every write inside a
	//    single transaction so a failure mid-batch cannot leave
	//    the keys mismatched against the rotation timestamp.
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Move the current keypair into the prev slot. Only
		// when there *is* a current key — first rotation on a
		// freshly bootstrapped station has nothing to demote.
		if prevPriv != "" {
			if err := upsertMetaTx(tx, metaKeyFedPrivPrev, prevPriv, now); err != nil {
				return err
			}
		}
		if prevKID != "" {
			if err := upsertMetaTx(tx, metaKeyFedKIDPrev, prevKID, now); err != nil {
				return err
			}
		}
		if err := upsertMetaTx(tx, metaKeyFedPriv, privPEM, now); err != nil {
			return err
		}
		if err := upsertMetaTx(tx, metaKeyFedPub, pubPEM, now); err != nil {
			return err
		}
		if err := upsertMetaTx(tx, metaKeyFedKID, kid, now); err != nil {
			return err
		}
		if err := upsertMetaTx(tx, metaKeyFedRotatedAt, rotatedAtStr, now); err != nil {
			return err
		}
		// Bump capability_version inside the same transaction
		// so peers cannot observe a half-rotated state on a
		// /capabilities re-read between the key write and the
		// version bump.
		newCap := newDashboardULID(now)
		return upsertMetaTx(tx, metaKeyCapVersion, newCap, now)
	})
	if err != nil {
		return nil, err
	}

	newCap, _ := r.readMetaValue(ctx, metaKeyCapVersion)

	return &domain.OSSFederationRotateResponse{
		NewKID:            kid,
		PreviousKID:       prevKID,
		RotatedAt:         rotatedAt,
		CapabilityVersion: newCap,
	}, nil
}

// readMetaValue reads a single oss_meta row's value. Returns ""
// when the row is absent, with a nil error — matches the OSS
// MetaRepository.Get semantics so the rotation flow can branch on
// "first rotation" vs "regular rotation" without a custom
// sentinel.
func (r *ossRepository) readMetaValue(ctx context.Context, key string) (string, error) {
	type metaRowSelect struct{ Value string }
	var row metaRowSelect
	err := r.db.WithContext(ctx).Table(tblOSSMeta).
		Select("value").
		Where("key = ?", key).
		Take(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return row.Value, nil
}

// upsertMetaTx writes (key, value, updated_at) inside the given
// transaction. Insert-or-update via WHERE-then-INSERT is the same
// shape the OSS MetaRepository uses, kept here to avoid importing
// the OSS subserver's repo from the dashboard.
func upsertMetaTx(tx *gorm.DB, key, value string, now time.Time) error {
	type metaRow struct {
		Key       string    `gorm:"primaryKey;column:key"`
		Value     string    `gorm:"column:value"`
		UpdatedAt time.Time `gorm:"column:updated_at"`
	}
	res := tx.Table(tblOSSMeta).Where("key = ?", key).
		Updates(map[string]any{"value": value, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		row := metaRow{Key: key, Value: value, UpdatedAt: now}
		if err := tx.Table(tblOSSMeta).Create(&row).Error; err != nil {
			if !isUniqueViolationDashboard(err) {
				return err
			}
			// Race lost: another writer inserted the row in
			// the gap. Re-apply the update so our value wins.
			if err2 := tx.Table(tblOSSMeta).Where("key = ?", key).
				Updates(map[string]any{"value": value, "updated_at": now}).Error; err2 != nil {
				return err2
			}
		}
	}
	return nil
}

// encodeFederationKeyForRotation marshals an Ed25519 keypair to
// the PEM shape persisted in oss_meta. Mirrors the OSS subserver's
// `encodeFederationKey` so a rehydration on either side produces
// the same KID for the same key bytes.
func encodeFederationKeyForRotation(priv ed25519.PrivateKey, pub ed25519.PublicKey) (privPEM, pubPEM, kid string, err error) {
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return "", "", "", err
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", "", "", err
	}
	privPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}))
	pubPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))
	sum := sha256.Sum256(pubDER)
	kid = strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:]))[:26]
	return privPEM, pubPEM, kid, nil
}

// visibilityIsTightening tells whether the move from prev → next
// is restrictive (caches must invalidate). The order, from most
// permissive to least, is public > chat > private.
func visibilityIsTightening(prev, next string) bool {
	rank := map[string]int{
		visibilityPublicConst:  3,
		visibilityChatConst:    2,
		visibilityPrivateConst: 1,
	}
	return rank[next] > 0 && rank[prev] > 0 && rank[next] < rank[prev]
}

// bumpCapabilityVersion writes a fresh ULID into oss_meta
// (capability_version). We use upsert semantics so the first call
// after a clean bootstrap also creates the row.
func (r *ossRepository) bumpCapabilityVersion(ctx context.Context) error {
	if r.db == nil || !r.db.Migrator().HasTable(tblOSSMeta) {
		return nil
	}
	now := time.Now()
	val := newDashboardULID(now)
	type metaRow struct {
		Key       string    `gorm:"primaryKey;column:key"`
		Value     string    `gorm:"column:value"`
		UpdatedAt time.Time `gorm:"column:updated_at"`
	}
	row := metaRow{Key: metaKeyCapVersion, Value: val, UpdatedAt: now}
	res := r.db.WithContext(ctx).Table(tblOSSMeta).Where("key = ?", metaKeyCapVersion).
		Updates(map[string]any{"value": val, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		// Row didn't exist yet; insert.
		if err := r.db.WithContext(ctx).Table(tblOSSMeta).Create(&row).Error; err != nil {
			// Race: another writer may have inserted in the
			// gap. Treat unique violation as success — the
			// invariant "capability_version is fresh after
			// this call" still holds.
			if !isUniqueViolationDashboard(err) {
				return err
			}
		}
	}
	return nil
}

// Visibility constants — duplicated here so the repo does not
// import the domain or oss subserver model.
const (
	visibilityPublicConst   = "public"
	visibilityChatConst     = "chat"
	visibilityPrivateConst  = "private"
	metaKeyCapVersion       = "capability_version"
)

// ---------------------------------------------------------------------------
// OSS audit append (admin actions)
// ---------------------------------------------------------------------------

// auditRow mirrors ossmodel.Audit's column shape. Same
// duplicate-rather-than-import rationale as bucketRow.
type auditRow struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement;column:id"`
	TS               time.Time `gorm:"column:ts;not null"`
	Action           string    `gorm:"column:action"`
	FileKey          string    `gorm:"column:file_key"`
	BucketID         string    `gorm:"column:bucket_id"`
	ActorID          string    `gorm:"column:actor_id"`
	PeerStationID    string    `gorm:"column:peer_station_id"`
	SizeBytes        int64     `gorm:"column:size_bytes"`
	Outcome          string    `gorm:"column:outcome"`
	Reason           string    `gorm:"column:reason"`
	FileID           string    `gorm:"column:file_id"`
	DashboardActorID string    `gorm:"column:dashboard_actor_id"`
	RequestID        string    `gorm:"column:request_id"`
}

func (auditRow) TableName() string { return tblOSSAudit }

func (r *ossRepository) RecordOSSAudit(ctx context.Context, evt OSSAuditAppend) error {
	if r.db == nil {
		return nil
	}
	if !r.db.Migrator().HasTable(tblOSSAudit) {
		return nil
	}
	row := auditRow{
		TS:               time.Now(),
		Action:           evt.Action,
		FileKey:          evt.FileKey,
		BucketID:         evt.BucketID,
		ActorID:          evt.ActorID,
		FileID:           evt.FileID,
		DashboardActorID: evt.DashboardActorID,
		SizeBytes:        evt.SizeBytes,
		Outcome:          evt.Outcome,
		Reason:           evt.Reason,
		RequestID:        evt.RequestID,
	}
	return r.db.WithContext(ctx).Create(&row).Error
}

// ---------------------------------------------------------------------------
// Local helpers — kept here (not in a shared util) so the dashboard
// module never imports oss/db/repo. The behaviour matches the OSS
// subserver's util.go closely enough for our purposes.
// ---------------------------------------------------------------------------

var (
	dashULIDEntropy   ulid.MonotonicReader
	dashULIDEntropyMu sync.Mutex
	dashULIDOnce      sync.Once
)

func newDashboardULID(now time.Time) string {
	dashULIDOnce.Do(func() {
		src := mathrand.New(mathrand.NewSource(time.Now().UnixNano())) //nolint:gosec
		dashULIDEntropy = ulid.Monotonic(src, 0)
	})
	dashULIDEntropyMu.Lock()
	defer dashULIDEntropyMu.Unlock()
	id, err := ulid.New(ulid.Timestamp(now), dashULIDEntropy)
	if err != nil {
		return ulid.Make().String()
	}
	return id.String()
}

// isUniqueViolationDashboard duplicates oss/db/repo.isUniqueViolation
// because the dashboard module deliberately does not import that
// package. Matches the same pgconn / sqlite forms.
func isUniqueViolationDashboard(err error) bool {
	if err == nil {
		return false
	}
	// Postgres returns the `pgconn.PgError` type; we cannot
	// import the package without pulling pgx into the dashboard
	// build. Instead we string-match SQLSTATE 23505 in the
	// formatted error — the production deployment surfaces it
	// as part of the message.
	msg := err.Error()
	if strings.Contains(msg, "23505") {
		return true
	}
	if strings.Contains(msg, "UNIQUE constraint failed") {
		return true
	}
	return false
}
