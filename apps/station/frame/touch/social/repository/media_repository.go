package repository

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type MediaRepository interface {
	Create(ctx context.Context, media *db.PostMedia) error
	GetByID(ctx context.Context, id uint64) (*db.PostMedia, error)
	GetByIDs(ctx context.Context, ids []uint64) ([]*db.PostMedia, error)
	Update(ctx context.Context, media *db.PostMedia) error
	Delete(ctx context.Context, id uint64) error
	ListByUser(ctx context.Context, userID uint64, limit int) ([]*db.PostMedia, error)
}

type mediaRepository struct {
	db *gorm.DB
}

func NewMediaRepository(db *gorm.DB) MediaRepository {
	return &mediaRepository{db: db}
}

func (r *mediaRepository) Create(ctx context.Context, media *db.PostMedia) error {
	return r.db.WithContext(ctx).Create(media).Error
}

func (r *mediaRepository) GetByID(ctx context.Context, id uint64) (*db.PostMedia, error) {
	var media db.PostMedia
	err := r.db.WithContext(ctx).
		Where("id = ?", id).
		First(&media).Error
	if err != nil {
		return nil, err
	}
	return &media, nil
}

func (r *mediaRepository) GetByIDs(ctx context.Context, ids []uint64) ([]*db.PostMedia, error) {
	if len(ids) == 0 {
		return []*db.PostMedia{}, nil
	}

	var media []*db.PostMedia
	err := r.db.WithContext(ctx).
		Where("id IN ?", ids).
		Find(&media).Error

	return media, err
}

func (r *mediaRepository) Update(ctx context.Context, media *db.PostMedia) error {
	return r.db.WithContext(ctx).Save(media).Error
}

func (r *mediaRepository) Delete(ctx context.Context, id uint64) error {
	return r.db.WithContext(ctx).
		Where("id = ?", id).
		Delete(&db.PostMedia{}).Error
}

func (r *mediaRepository) ListByUser(ctx context.Context, userID uint64, limit int) ([]*db.PostMedia, error) {
	var media []*db.PostMedia
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Find(&media).Error

	return media, err
}
