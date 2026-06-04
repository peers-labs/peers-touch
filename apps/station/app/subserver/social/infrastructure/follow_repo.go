package infrastructure

import (
	"context"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// FollowRepository is the broader follow-graph API used by the social
// subserver's RelationshipService (follow/unfollow toggles, follower /
// following pagination, batch relationship lookups).
//
// It is a SUPERSET of `domain.FollowRepository` — the narrow interface
// MomentService consumes for HOME timeline assembly. Both interfaces are
// satisfied by the same `followRepository` struct, so the application
// layer can hand the same instance to both services without an extra
// adapter.
type FollowRepository interface {
	domain.FollowRepository

	Follow(ctx context.Context, followerID, followingID uint64) error
	Unfollow(ctx context.Context, followerID, followingID uint64) error
	GetRelationship(ctx context.Context, followerID, followingID uint64) (*db.Follow, error)
	GetFollowers(ctx context.Context, actorID uint64, c domain.Cursor, limit int) ([]*db.Follow, error)
	GetFollowing(ctx context.Context, actorID uint64, c domain.Cursor, limit int) ([]*db.Follow, error)
	GetFollowerCount(ctx context.Context, actorID uint64) (int64, error)
	GetFollowingCount(ctx context.Context, actorID uint64) (int64, error)
	GetRelationships(ctx context.Context, followerID uint64, targetIDs []uint64) (map[uint64]*db.Follow, error)
	GetReverseRelationships(ctx context.Context, followingID uint64, followerIDs []uint64) (map[uint64]bool, error)
}

type followRepository struct {
	db *gorm.DB
}

func NewFollowRepository(gdb *gorm.DB) FollowRepository {
	return &followRepository{db: gdb}
}

// ---------------------------------------------------------------------------
// domain.FollowRepository
// ---------------------------------------------------------------------------

func (r *followRepository) FollowingActorIDs(ctx context.Context, viewerID uint64) ([]uint64, error) {
	if viewerID == 0 {
		return nil, nil
	}
	var ids []uint64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ?", viewerID).
		Pluck("following_id", &ids).Error
	return ids, err
}

func (r *followRepository) FollowerActorIDs(ctx context.Context, authorID uint64) ([]uint64, error) {
	if authorID == 0 {
		return nil, nil
	}
	var ids []uint64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("following_id = ?", authorID).
		Pluck("follower_id", &ids).Error
	return ids, err
}

func (r *followRepository) IsFollowing(ctx context.Context, followerID, followingID uint64) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ? AND following_id = ?", followerID, followingID).
		Count(&count).Error
	return count > 0, err
}

// ---------------------------------------------------------------------------
// Broader RelationshipService surface
// ---------------------------------------------------------------------------

func (r *followRepository) Follow(ctx context.Context, followerID, followingID uint64) error {
	if followerID == 0 || followingID == 0 {
		return gorm.ErrInvalidData
	}
	if followerID == followingID {
		return gorm.ErrInvalidData
	}

	var existing db.Follow
	err := r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id = ?", followerID, followingID).
		First(&existing).Error
	if err == nil {
		return nil // idempotent: already following
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

func (r *followRepository) GetFollowers(ctx context.Context, actorID uint64, c domain.Cursor, limit int) ([]*db.Follow, error) {
	q := r.db.WithContext(ctx).
		Where("following_id = ?", actorID).
		Order("created_at DESC, id DESC")
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var follows []*db.Follow
	err := q.Limit(limit).Find(&follows).Error
	return follows, err
}

func (r *followRepository) GetFollowing(ctx context.Context, actorID uint64, c domain.Cursor, limit int) ([]*db.Follow, error) {
	q := r.db.WithContext(ctx).
		Where("follower_id = ?", actorID).
		Order("created_at DESC, id DESC")
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var follows []*db.Follow
	err := q.Limit(limit).Find(&follows).Error
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
	out := make(map[uint64]*db.Follow, len(follows))
	for _, f := range follows {
		out[f.FollowingID] = f
	}
	return out, nil
}

func (r *followRepository) GetReverseRelationships(ctx context.Context, followingID uint64, followerIDs []uint64) (map[uint64]bool, error) {
	out := make(map[uint64]bool)
	if followingID == 0 || len(followerIDs) == 0 {
		return out, nil
	}
	var follows []*db.Follow
	err := r.db.WithContext(ctx).
		Where("following_id = ? AND follower_id IN ?", followingID, followerIDs).
		Find(&follows).Error
	if err != nil {
		return nil, err
	}
	for _, f := range follows {
		out[f.FollowerID] = true
	}
	return out, nil
}
