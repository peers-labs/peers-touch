package repo

import (
	"context"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type FileRepository interface {
	Create(ctx context.Context, meta *ossmodel.FileMeta) error
	FindByKey(ctx context.Context, key string) (*ossmodel.FileMeta, error)
}

type fileRepo struct {
	dbName string
}

func NewFileRepository(dbName string) FileRepository {
	return &fileRepo{dbName: dbName}
}

func (r *fileRepo) getDB(ctx context.Context) (*gorm.DB, error) {
	if r.dbName == "" {
		return store.GetRDS(ctx)
	}
	return store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
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
	err = db.Where("key = ?", key).First(&meta).Error
	return &meta, err
}
