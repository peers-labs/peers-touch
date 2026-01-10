package repository

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type PostRepository interface {
	Create(ctx context.Context, post *db.Post) error
	GetByID(ctx context.Context, id uint64) (*db.Post, error)
	Update(ctx context.Context, post *db.Post) error
	Delete(ctx context.Context, id uint64) error
	ListByAuthor(ctx context.Context, authorID uint64, cursor *Cursor, limit int) ([]*db.Post, error)
	ListByIDs(ctx context.Context, ids []uint64) ([]*db.Post, error)
	ListByFollowing(ctx context.Context, userID uint64, cursor *Cursor, limit int) ([]*db.Post, error)
	ListPublic(ctx context.Context, cursor *Cursor, limit int) ([]*db.Post, error)
}

type Cursor struct {
	CreatedAt time.Time
	ID        uint64
}

type postRepository struct {
	db *gorm.DB
}

func NewPostRepository(db *gorm.DB) PostRepository {
	return &postRepository{db: db}
}

func (r *postRepository) Create(ctx context.Context, post *db.Post) error {
	return r.db.WithContext(ctx).Create(post).Error
}

func (r *postRepository) GetByID(ctx context.Context, id uint64) (*db.Post, error) {
	var post db.Post
	err := r.db.WithContext(ctx).
		Preload("Author").
		Preload("Content").
		Where("id = ? AND deleted_at IS NULL", id).
		First(&post).Error
	if err != nil {
		return nil, err
	}
	return &post, nil
}

func (r *postRepository) Update(ctx context.Context, post *db.Post) error {
	return r.db.WithContext(ctx).Save(post).Error
}

func (r *postRepository) Delete(ctx context.Context, id uint64) error {
	now := time.Now()
	return r.db.WithContext(ctx).
		Model(&db.Post{}).
		Where("id = ?", id).
		Update("deleted_at", now).Error
}

func (r *postRepository) ListByAuthor(ctx context.Context, authorID uint64, cursor *Cursor, limit int) ([]*db.Post, error) {
	query := r.db.WithContext(ctx).
		Preload("Author").
		Preload("Content").
		Where("author_id = ? AND deleted_at IS NULL", authorID)

	if cursor != nil {
		query = query.Where("(created_at, id) < (?, ?)", cursor.CreatedAt, cursor.ID)
	}

	var posts []*db.Post
	err := query.
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&posts).Error

	return posts, err
}

func (r *postRepository) ListByIDs(ctx context.Context, ids []uint64) ([]*db.Post, error) {
	if len(ids) == 0 {
		return []*db.Post{}, nil
	}

	var posts []*db.Post
	err := r.db.WithContext(ctx).
		Preload("Author").
		Preload("Content").
		Where("id IN ? AND deleted_at IS NULL", ids).
		Find(&posts).Error

	return posts, err
}

func (r *postRepository) ListByFollowing(ctx context.Context, userID uint64, cursor *Cursor, limit int) ([]*db.Post, error) {
	var followingIDs []uint64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ?", userID).
		Pluck("following_id", &followingIDs).Error
	if err != nil {
		return nil, err
	}

	if len(followingIDs) == 0 {
		return []*db.Post{}, nil
	}

	query := r.db.WithContext(ctx).
		Preload("Author").
		Preload("Content").
		Where("author_id IN ? AND deleted_at IS NULL", followingIDs).
		Where("visibility IN ?", []string{"public", "followers"})

	if cursor != nil {
		query = query.Where("(created_at, id) < (?, ?)", cursor.CreatedAt, cursor.ID)
	}

	var posts []*db.Post
	err = query.
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&posts).Error

	return posts, err
}

func (r *postRepository) ListPublic(ctx context.Context, cursor *Cursor, limit int) ([]*db.Post, error) {
	query := r.db.WithContext(ctx).
		Preload("Author").
		Preload("Content").
		Where("visibility = ? AND deleted_at IS NULL", "public")

	if cursor != nil {
		query = query.Where("(created_at, id) < (?, ?)", cursor.CreatedAt, cursor.ID)
	}

	var posts []*db.Post
	err := query.
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&posts).Error

	return posts, err
}
