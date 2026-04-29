package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// BlobRepository is the persistence boundary for `oss_blobs`. It is
// the source of truth for "is anyone still pointing at these bytes?"
// — the upload writer increments on claim creation, the lifecycle
// path (DELETE / TTL sweep / admin_delete) decrements, and the
// `BlobGC` worker physically removes rows where `RefCount == 0`
// after the configured grace window.
//
// All counter mutations are single-statement UPDATEs: the
// `Touch` / `Release` paths never SELECT-then-write, so two
// concurrent uploads of the same CAS bytes cannot drift the counter.
//
// `Get` and `ListGCCandidates` are the read primitives the GC worker
// uses; they live on the repository (rather than as ad-hoc queries
// inside the worker) so they can be stubbed in unit tests without
// standing up a SQLite database.
type BlobRepository interface {
	// Touch is called from the upload writer right after a
	// successful `backend.Save`. It either inserts a fresh row
	// (`ref_count = 1`) or atomically increments an existing row's
	// counter and bumps `last_seen_at`. Returns the resulting row.
	//
	// `size` and `sha256` are written on insert and *not* updated
	// on the increment path — the bytes are the same content, by
	// definition; an actor uploading bytes that produce a colliding
	// CAS key with different size/sha is a backend bug, not a race.
	Touch(ctx context.Context, backend, key string, size int64, sha256 string) (*ossmodel.Blob, error)

	// Release decrements the counter, with a positive predicate so
	// it cannot go negative. Returns the new RefCount and a flag
	// indicating whether the row dropped to zero (so the caller can
	// short-circuit `backend.Delete` synchronously when the grace
	// window is zero / a test forces immediate cleanup).
	//
	// Returns ErrBlobNotFound if no row exists; callers (the
	// lifecycle path) should treat this as an audit anomaly rather
	// than a fatal error.
	Release(ctx context.Context, backend, key string) (refCount int64, droppedToZero bool, err error)

	// Get returns the row, or (nil, nil) when absent. The blob GC
	// worker uses it to confirm a row before issuing a physical
	// delete; the reconciler uses it to compare counters.
	Get(ctx context.Context, backend, key string) (*ossmodel.Blob, error)

	// ListGCCandidates returns rows where `RefCount = 0` and
	// `LastSeenAt < olderThan`, ordered by `LastSeenAt ASC` so the
	// worker drains the oldest first. The `limit` argument bounds
	// the worker's batch size to avoid a runaway DELETE on a backlog.
	ListGCCandidates(ctx context.Context, olderThan time.Time, limit int) ([]ossmodel.Blob, error)

	// Delete removes the row. Called by the GC worker only after
	// the matching `backend.Delete` has succeeded. Idempotent: a
	// missing row returns nil (something else got there first; not
	// an error).
	Delete(ctx context.Context, backend, key string) error
}

// ErrBlobNotFound is returned by `Release` when the (backend, key)
// row is absent. Callers should record an audit row with
// `outcome=error, reason=blob_missing` rather than propagating.
var ErrBlobNotFound = errors.New("oss: blob: not found")

type blobRepo struct {
	dbName string
	clock  func() time.Time
}

// NewBlobRepository wires the repo to its named gorm DB.
func NewBlobRepository(dbName string) BlobRepository {
	return &blobRepo{dbName: dbName, clock: time.Now}
}

func (r *blobRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *blobRepo) Touch(ctx context.Context, backend, key string, size int64, sha256 string) (*ossmodel.Blob, error) {
	if backend == "" || key == "" {
		return nil, errors.New("oss: blob touch: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := r.clock()

	// Increment-or-insert is two SQL statements wrapped in a
	// transaction so the read-modify-write sequence cannot interleave
	// with a parallel uploader.
	var row ossmodel.Blob
	err = db.Transaction(func(tx *gorm.DB) error {
		// Try the cheap path first: a single UPDATE that bumps the
		// counter and the timestamp. RowsAffected tells us whether
		// the row existed.
		res := tx.Model(&ossmodel.Blob{}).
			Where("backend = ? AND key = ?", backend, key).
			Updates(map[string]any{
				"ref_count":    gorm.Expr("ref_count + 1"),
				"last_seen_at": now,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// No row yet — insert. We do not protect against a race
			// here at the SQL level; the composite primary key on
			// (backend, key) means a concurrent insert from another
			// transaction will fail the second writer, who can
			// retry the UPDATE branch.
			fresh := ossmodel.Blob{
				Backend:    backend,
				Key:        key,
				Size:       size,
				Sha256:     sha256,
				RefCount:   1,
				LastSeenAt: now,
				CreatedAt:  now,
			}
			if err := tx.Create(&fresh).Error; err != nil {
				return err
			}
		}
		// Re-read so the caller sees the authoritative row state
		// regardless of which branch we took.
		return tx.Where("backend = ? AND key = ?", backend, key).First(&row).Error
	})
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *blobRepo) Release(ctx context.Context, backend, key string) (int64, bool, error) {
	if backend == "" || key == "" {
		return 0, false, errors.New("oss: blob release: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return 0, false, err
	}

	var newCount int64
	var droppedToZero bool
	err = db.Transaction(func(tx *gorm.DB) error {
		// Positive predicate is the safety belt: a buggy caller
		// double-releasing cannot push the counter below zero.
		res := tx.Model(&ossmodel.Blob{}).
			Where("backend = ? AND key = ? AND ref_count > 0", backend, key).
			Updates(map[string]any{
				"ref_count": gorm.Expr("ref_count - 1"),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// Two cases: no row, or row at zero already. Disambiguate.
			var probe ossmodel.Blob
			err := tx.Where("backend = ? AND key = ?", backend, key).First(&probe).Error
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrBlobNotFound
				}
				return err
			}
			// Row exists with ref_count == 0 — caller is double-
			// releasing. We surface this as a benign zero result
			// rather than an error so the lifecycle path stays
			// idempotent on retries.
			newCount = 0
			droppedToZero = false
			return nil
		}
		var row ossmodel.Blob
		if err := tx.Where("backend = ? AND key = ?", backend, key).First(&row).Error; err != nil {
			return err
		}
		newCount = row.RefCount
		droppedToZero = row.RefCount == 0
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	return newCount, droppedToZero, nil
}

func (r *blobRepo) Get(ctx context.Context, backend, key string) (*ossmodel.Blob, error) {
	if backend == "" || key == "" {
		return nil, errors.New("oss: blob get: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row ossmodel.Blob
	err = db.Where("backend = ? AND key = ?", backend, key).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *blobRepo) ListGCCandidates(ctx context.Context, olderThan time.Time, limit int) ([]ossmodel.Blob, error) {
	if limit <= 0 {
		limit = 100
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []ossmodel.Blob
	err = db.Where("ref_count = 0 AND last_seen_at < ?", olderThan).
		Order("last_seen_at ASC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *blobRepo) Delete(ctx context.Context, backend, key string) error {
	if backend == "" || key == "" {
		return errors.New("oss: blob delete: backend and key required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Where("backend = ? AND key = ?", backend, key).
		Delete(&ossmodel.Blob{}).Error
}
