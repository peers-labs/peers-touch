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
	"errors"
	"math/rand"
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
	metaKeyFedPub = "federation_pub_pem"
	metaKeyFedKID = "federation_kid"
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
		src := rand.New(rand.NewSource(time.Now().UnixNano())) //nolint:gosec
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
