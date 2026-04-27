package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// AuditRepository is append-only by design — there is no Update or
// Delete-by-id method. The retention sweep uses a single time-based
// DELETE through `Trim`, so the rest of the codebase cannot
// accidentally mutate audit history.
type AuditRepository interface {
	Append(ctx context.Context, evt ossmodel.Audit) error
	Query(ctx context.Context, q AuditQuery) ([]ossmodel.Audit, int64, error)

	// Trim deletes audit rows older than the given cutoff. The
	// dashboard subserver is expected to call this on a periodic
	// schedule (configured via OSS subserver options) — not from
	// any per-request path.
	Trim(ctx context.Context, olderThan time.Time) (int64, error)
}

// AuditQuery is the filter envelope used by the dashboard
// `/dashboard/api/oss/audit` endpoint and by manual ops queries.
// Empty fields mean "no filter".
type AuditQuery struct {
	Action   string
	ActorID  string
	BucketID string
	FileKey  string
	Outcome  string

	Since time.Time
	Until time.Time

	Page     int
	PageSize int
}

type auditRepo struct {
	dbName string
	clock  func() time.Time
}

// NewAuditRepository wires the repo to its named gorm DB.
func NewAuditRepository(dbName string) AuditRepository {
	return &auditRepo{dbName: dbName, clock: time.Now}
}

func (r *auditRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *auditRepo) Append(ctx context.Context, evt ossmodel.Audit) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	if evt.TS.IsZero() {
		evt.TS = r.clock()
	}
	return db.Create(&evt).Error
}

// Query executes the filter and returns (rows, total, err). When
// pagination is requested (PageSize > 0), `total` is the unpaginated
// row count so the dashboard can render "page x of y".
func (r *auditRepo) Query(ctx context.Context, q AuditQuery) ([]ossmodel.Audit, int64, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	tx := db.Model(&ossmodel.Audit{})
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

	var rows []ossmodel.Audit
	if err := tx.Order("ts DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *auditRepo) Trim(ctx context.Context, olderThan time.Time) (int64, error) {
	if olderThan.IsZero() {
		return 0, nil
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return 0, err
	}
	res := db.Where("ts < ?", olderThan).Delete(&ossmodel.Audit{})
	return res.RowsAffected, res.Error
}
