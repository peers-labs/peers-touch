package repository

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type CommentRepository interface {
	Create(ctx context.Context, comment *db.Comment) error
	GetByID(ctx context.Context, id uint64) (*db.Comment, error)
	Update(ctx context.Context, comment *db.Comment) error
	Delete(ctx context.Context, id uint64) error
	ListByPost(ctx context.Context, postID uint64, cursor *Cursor, limit int) ([]*db.Comment, error)
	GetCommentsCount(ctx context.Context, postID uint64) (int64, error)
}

type commentRepository struct {
	db *gorm.DB
}

func NewCommentRepository(db *gorm.DB) CommentRepository {
	return &commentRepository{db: db}
}

func (r *commentRepository) Create(ctx context.Context, comment *db.Comment) error {
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *commentRepository) GetByID(ctx context.Context, id uint64) (*db.Comment, error) {
	var comment db.Comment
	err := r.db.WithContext(ctx).
		Preload("Author").
		Where("id = ? AND deleted_at IS NULL", id).
		First(&comment).Error
	if err != nil {
		return nil, err
	}
	return &comment, nil
}

func (r *commentRepository) Update(ctx context.Context, comment *db.Comment) error {
	return r.db.WithContext(ctx).Save(comment).Error
}

func (r *commentRepository) Delete(ctx context.Context, id uint64) error {
	now := time.Now()
	return r.db.WithContext(ctx).
		Model(&db.Comment{}).
		Where("id = ?", id).
		Update("deleted_at", now).Error
}

func (r *commentRepository) ListByPost(ctx context.Context, postID uint64, cursor *Cursor, limit int) ([]*db.Comment, error) {
	query := r.db.WithContext(ctx).
		Preload("Author").
		Where("post_id = ? AND deleted_at IS NULL", postID)

	if cursor != nil {
		query = query.Where("(created_at, id) < (?, ?)", cursor.CreatedAt, cursor.ID)
	}

	var comments []*db.Comment
	err := query.
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&comments).Error

	return comments, err
}

func (r *commentRepository) GetCommentsCount(ctx context.Context, postID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.Comment{}).
		Where("post_id = ? AND deleted_at IS NULL", postID).
		Count(&count).Error
	return count, err
}
