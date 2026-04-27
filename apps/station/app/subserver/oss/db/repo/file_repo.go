package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// FileRepository is the persistence boundary for `oss_files`. It
// exposes two read paths because the (owner, key) tuple is the new
// uniqueness contract while plain `key` lookups remain useful for
// federation/public reads where the caller may not yet know the
// owner DID.
//
// All "Find" methods return only *live* rows by default — soft-
// deleted rows are filtered out so user-visible reads behave
// correctly. The upload writer needs the deleted rows to detect
// "CAS bytes match an existing-but-deleted row → revive instead of
// re-create"; it goes through the explicit `…IncludeDeleted`
// variant rather than the default.
type FileRepository interface {
	Create(ctx context.Context, meta *ossmodel.FileMeta) error

	// FindByKey returns *any* live meta for the key — the oldest
	// one by CreatedAt. Use for public reads / federation lookups
	// where the caller has not (or cannot) supply an owner. For
	// permission-aware reads prefer `FindByOwnerKey`.
	FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error)

	// FindByOwnerKey returns the live (owner, key) row, if any.
	// This is the read-side primitive — handlers reading bytes use
	// it; dedup short-circuits on the upload write path go through
	// `FindByOwnerKeyIncludeDeleted` so they observe revivable
	// deleted rows.
	FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error)

	// FindByOwnerKeyIncludeDeleted is the same lookup but does NOT
	// filter `deleted_at IS NULL`. The upload writer uses it to
	// distinguish three cases:
	//
	//   - no row at all → fresh upload
	//   - live row → CAS dedup short-circuit (existing behaviour)
	//   - soft-deleted row → revive (clear DeletedAt, bump
	//     blob ref_count, addUsage)
	//
	// Callers MUST inspect `meta.DeletedAt` before treating the
	// row as a dedup hit.
	FindByOwnerKeyIncludeDeleted(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error)

	// Restore clears `DeletedAt`, bumps `UpdatedAt`, and optionally
	// resets `ExpiresAt` (when `newExpires` is non-nil). It is the
	// inverse of `MarkDeleted`. Returns ErrFileNotFound if the row
	// is missing entirely.
	//
	// Used by:
	//   - the upload writer when CAS hits a soft-deleted row;
	//   - the explicit `POST /sub-oss/file/:key/restore` handler
	//     (within the soft-delete grace window).
	Restore(ctx context.Context, id string, now time.Time, newExpires *time.Time) error
}

// ErrFileNotFound is returned by repository methods that need to
// signal "no row exists" without exposing the underlying GORM
// sentinel. Callers branch on this rather than checking
// `errors.Is(err, gorm.ErrRecordNotFound)` so the abstraction
// stays portable across drivers.
var ErrFileNotFound = errors.New("oss: file not found")

type fileRepo struct {
	dbName string
}

func NewFileRepository(dbName string) FileRepository {
	return &fileRepo{dbName: dbName}
}

func (r *fileRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return nil, errors.New("database '" + r.dbName + "' not found: " + err.Error())
	}
	return db, nil
}

func (r *fileRepo) Create(ctx context.Context, meta *ossmodel.FileMeta) error {
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Create(meta).Error
}

func (r *fileRepo) FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("key = ? AND deleted_at IS NULL", key).
		Order("created_at ASC").
		First(&meta).Error
	return &meta, err
}

func (r *fileRepo) FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("owner_actor_id = ? AND key = ? AND deleted_at IS NULL", owner, key).
		First(&meta).Error
	return &meta, err
}

func (r *fileRepo) FindByOwnerKeyIncludeDeleted(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("owner_actor_id = ? AND key = ?", owner, key).First(&meta).Error
	return &meta, err
}

func (r *fileRepo) Restore(ctx context.Context, id string, now time.Time, newExpires *time.Time) error {
	if id == "" {
		return errors.New("oss: file restore: id required")
	}
	db, err := r.getDB(ctx)
	if err != nil {
		return err
	}
	updates := map[string]any{
		"deleted_at": nil,
		"updated_at": now,
	}
	if newExpires != nil {
		// nil pointer would otherwise leave the column alone; a
		// non-nil pointer means "set to this value (which may be
		// the zero time, signalling NULL)".
		if newExpires.IsZero() {
			updates["expires_at"] = nil
		} else {
			updates["expires_at"] = *newExpires
		}
	}
	res := db.Model(&ossmodel.FileMeta{}).
		Where("id = ?", id).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrFileNotFound
	}
	return nil
}
