package repository

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type FollowRepository interface {
	Follow(ctx context.Context, followerID, followingID uint64) error
	Unfollow(ctx context.Context, followerID, followingID uint64) error
	IsFollowing(ctx context.Context, followerID, followingID uint64) (bool, error)
	GetRelationship(ctx context.Context, followerID, followingID uint64) (*db.Follow, error)
	GetFollowers(ctx context.Context, actorID uint64, cursor *Cursor, limit int) ([]*db.Follow, error)
	GetFollowing(ctx context.Context, actorID uint64, cursor *Cursor, limit int) ([]*db.Follow, error)
	GetFollowerCount(ctx context.Context, actorID uint64) (int64, error)
	GetFollowingCount(ctx context.Context, actorID uint64) (int64, error)
	GetRelationships(ctx context.Context, followerID uint64, targetIDs []uint64) (map[uint64]*db.Follow, error)
}

type followRepository struct {
	db *gorm.DB
}

func NewFollowRepository(db *gorm.DB) FollowRepository {
	return &followRepository{db: db}
}

func (r *followRepository) Follow(ctx context.Context, followerID, followingID uint64) error {
	if followerID == followingID {
		return gorm.ErrInvalidData
	}

	var existingFollow db.Follow
	err := r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id = ?", followerID, followingID).
		First(&existingFollow).Error

	if err == nil {
		return nil
	}

	if err != gorm.ErrRecordNotFound {
		return err
	}

	follow := &db.Follow{
		ID:          id.NextID(),
		FollowerID:  followerID,
		FollowingID: followingID,
		CreatedAt:   time.Now(),
	}

	return r.db.WithContext(ctx).Create(follow).Error
}

func (r *followRepository) Unfollow(ctx context.Context, followerID, followingID uint64) error {
	return r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id = ?", followerID, followingID).
		Delete(&db.Follow{}).Error
}

func (r *followRepository) IsFollowing(ctx context.Context, followerID, followingID uint64) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ? AND following_id = ?", followerID, followingID).
		Count(&count).Error
	return count > 0, err
}

func (r *followRepository) GetRelationship(ctx context.Context, followerID, followingID uint64) (*db.Follow, error) {
	var follow db.Follow
	err := r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id = ?", followerID, followingID).
		First(&follow).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &follow, err
}

func (r *followRepository) GetFollowers(ctx context.Context, actorID uint64, cursor *Cursor, limit int) ([]*db.Follow, error) {
	query := r.db.WithContext(ctx).
		Preload("Follower").
		Where("following_id = ?", actorID).
		Order("created_at DESC, id DESC")

	if cursor != nil {
		query = query.Where("(created_at < ? OR (created_at = ? AND id < ?))",
			cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
	}

	var follows []*db.Follow
	err := query.Limit(limit).Find(&follows).Error
	return follows, err
}

func (r *followRepository) GetFollowing(ctx context.Context, actorID uint64, cursor *Cursor, limit int) ([]*db.Follow, error) {
	query := r.db.WithContext(ctx).
		Preload("Following").
		Where("follower_id = ?", actorID).
		Order("created_at DESC, id DESC")

	if cursor != nil {
		query = query.Where("(created_at < ? OR (created_at = ? AND id < ?))",
			cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
	}

	var follows []*db.Follow
	err := query.Limit(limit).Find(&follows).Error
	return follows, err
}

func (r *followRepository) GetFollowerCount(ctx context.Context, actorID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("following_id = ?", actorID).
		Count(&count).Error
	return count, err
}

func (r *followRepository) GetFollowingCount(ctx context.Context, actorID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ?", actorID).
		Count(&count).Error
	return count, err
}

func (r *followRepository) GetRelationships(ctx context.Context, followerID uint64, targetIDs []uint64) (map[uint64]*db.Follow, error) {
	if len(targetIDs) == 0 {
		return make(map[uint64]*db.Follow), nil
	}

	var follows []*db.Follow
	err := r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id IN ?", followerID, targetIDs).
		Find(&follows).Error
	if err != nil {
		return nil, err
	}

	result := make(map[uint64]*db.Follow)
	for _, follow := range follows {
		result[follow.FollowingID] = follow
	}
	return result, nil
}
