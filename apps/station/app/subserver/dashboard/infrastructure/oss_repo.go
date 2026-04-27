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
	"sort"
	"time"

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

// OSSRepository is the dashboard-side, read-mostly view of the OSS
// subsystem. The single mutating method is SetPeerPin — operator
// trust action, not a data-plane write — so the rest of the
// surface is pure SELECT.
type OSSRepository interface {
	ListBuckets(ctx context.Context) ([]domain.OSSBucketSummary, error)
	GetBucket(ctx context.Context, bucketID string) (*domain.OSSBucketSummary, error)
	ListObjects(ctx context.Context, q OSSObjectQuery) ([]domain.OSSObjectSummary, int64, error)
	ListAudit(ctx context.Context, q OSSAuditQuery) ([]domain.OSSAuditEvent, int64, error)
	Usage(ctx context.Context) (*domain.OSSUsageSummary, error)

	GetFederationLocal(ctx context.Context) (*domain.OSSFederationLocalKey, error)
	ListFederationPeers(ctx context.Context) ([]domain.OSSFederationPeer, error)
	SetPeerPin(ctx context.Context, peerStationID string, pinned bool) error
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
		Select("id, name, owner_actor_id, kind, system_key, default_visibility, quota_bytes, used_bytes, created_at, updated_at").
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
		Select("id, name, owner_actor_id, kind, system_key, default_visibility, quota_bytes, used_bytes, created_at, updated_at").
		Where("id = ?", bucketID).
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
