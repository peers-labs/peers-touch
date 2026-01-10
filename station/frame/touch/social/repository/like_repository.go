package repository

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type LikeRepository interface {
	CreatePostLike(ctx context.Context, like *db.PostLike) error
	DeletePostLike(ctx context.Context, userID, postID uint64) error
	IsPostLiked(ctx context.Context, userID, postID uint64) (bool, error)
	GetPostLikers(ctx context.Context, postID uint64, cursor *Cursor, limit int) ([]*db.Actor, error)
	GetPostLikesCount(ctx context.Context, postID uint64) (int64, error)
	
	CreateCommentLike(ctx context.Context, like *db.CommentLike) error
	DeleteCommentLike(ctx context.Context, userID, commentID uint64) error
	IsCommentLiked(ctx context.Context, userID, commentID uint64) (bool, error)
}

type likeRepository struct {
	db *gorm.DB
}

func NewLikeRepository(db *gorm.DB) LikeRepository {
	return &likeRepository{db: db}
}

func (r *likeRepository) CreatePostLike(ctx context.Context, like *db.PostLike) error {
	return r.db.WithContext(ctx).Create(like).Error
}

func (r *likeRepository) DeletePostLike(ctx context.Context, userID, postID uint64) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND post_id = ?", userID, postID).
		Delete(&db.PostLike{}).Error
}

func (r *likeRepository) IsPostLiked(ctx context.Context, userID, postID uint64) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.PostLike{}).
		Where("user_id = ? AND post_id = ?", userID, postID).
		Count(&count).Error
	return count > 0, err
}

func (r *likeRepository) GetPostLikers(ctx context.Context, postID uint64, cursor *Cursor, limit int) ([]*db.Actor, error) {
	query := r.db.WithContext(ctx).
		Table("touch_post_likes").
		Select("touch_actors.*").
		Joins("JOIN touch_actors ON touch_actors.id = touch_post_likes.user_id").
		Where("touch_post_likes.post_id = ?", postID)

	if cursor != nil {
		query = query.Where("touch_post_likes.created_at < ?", cursor.CreatedAt)
	}

	var actors []*db.Actor
	err := query.
		Order("touch_post_likes.created_at DESC").
		Limit(limit).
		Find(&actors).Error

	return actors, err
}

func (r *likeRepository) GetPostLikesCount(ctx context.Context, postID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.PostLike{}).
		Where("post_id = ?", postID).
		Count(&count).Error
	return count, err
}

func (r *likeRepository) CreateCommentLike(ctx context.Context, like *db.CommentLike) error {
	return r.db.WithContext(ctx).Create(like).Error
}

func (r *likeRepository) DeleteCommentLike(ctx context.Context, userID, commentID uint64) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND comment_id = ?", userID, commentID).
		Delete(&db.CommentLike{}).Error
}

func (r *likeRepository) IsCommentLiked(ctx context.Context, userID, commentID uint64) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.CommentLike{}).
		Where("user_id = ? AND comment_id = ?", userID, commentID).
		Count(&count).Error
	return count > 0, err
}
