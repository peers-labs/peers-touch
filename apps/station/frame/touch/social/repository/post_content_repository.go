package repository

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type PostContentRepository interface {
	Create(ctx context.Context, content *db.PostContent) error
	GetByPostID(ctx context.Context, postID uint64) (*db.PostContent, error)
	Update(ctx context.Context, content *db.PostContent) error
}

type postContentRepository struct {
	db *gorm.DB
}

func NewPostContentRepository(db *gorm.DB) PostContentRepository {
	return &postContentRepository{db: db}
}

func (r *postContentRepository) Create(ctx context.Context, content *db.PostContent) error {
	return r.db.WithContext(ctx).Create(content).Error
}

func (r *postContentRepository) GetByPostID(ctx context.Context, postID uint64) (*db.PostContent, error) {
	var content db.PostContent
	err := r.db.WithContext(ctx).
		Where("post_id = ?", postID).
		First(&content).Error
	if err != nil {
		return nil, err
	}
	return &content, nil
}

func (r *postContentRepository) Update(ctx context.Context, content *db.PostContent) error {
	return r.db.WithContext(ctx).Save(content).Error
}
