package repo

import (
	"context"
	"errors"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// FileRepository is the persistence boundary for `oss_files`. It
// exposes two read paths because the (owner, key) tuple is the new
// uniqueness contract while plain `key` lookups remain useful for
// federation/public reads where the caller may not yet know the
// owner DID.
type FileRepository interface {
	Create(ctx context.Context, meta *ossmodel.FileMeta) error

	// FindByKey returns *any* meta for the key — the oldest one by
	// CreatedAt. Use for public reads / federation lookups where
	// the caller has not (or cannot) supply an owner. For
	// permission-aware reads prefer `FindByOwnerKey`, which scopes
	// the lookup to a specific actor's claim.
	FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error)

	// FindByOwnerKey returns the (owner, key) row, if any. This is
	// the upload-path dedup primitive: same actor uploading the
	// same CAS bytes hits this row and short-circuits, but a
	// *different* actor uploading those same bytes misses and
	// proceeds to claim their own row over the shared blob on
	// disk.
	FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error)
}

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
	err = db.Where("key = ?", key).Order("created_at ASC").First(&meta).Error
	return &meta, err
}

func (r *fileRepo) FindByOwnerKey(ctx context.Context, owner, key string) (*ossmodel.FileMeta, error) {
	db, err := r.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var meta ossmodel.FileMeta
	err = db.Where("owner_actor_id = ? AND key = ?", owner, key).First(&meta).Error
	return &meta, err
}
