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

	Follow(ctx context.Context, followerPTID, followingPTID string) error
	Unfollow(ctx context.Context, followerPTID, followingPTID string) error
	GetRelationship(ctx context.Context, followerPTID, followingPTID string) (*db.Follow, error)
	GetFollowers(ctx context.Context, actorPTID string, c domain.Cursor, limit int) ([]*db.Follow, error)
	GetFollowing(ctx context.Context, actorPTID string, c domain.Cursor, limit int) ([]*db.Follow, error)
	GetFollowerCount(ctx context.Context, actorPTID string) (int64, error)
	GetFollowingCount(ctx context.Context, actorPTID string) (int64, error)
	GetRelationships(ctx context.Context, followerPTID string, targetPTIDs []string) (map[string]*db.Follow, error)
	GetReverseRelationships(ctx context.Context, followingPTID string, followerPTIDs []string) (map[string]bool, error)
}

type followRepository struct {
	db       *gorm.DB
	identity *ActorIdentity
}

func NewFollowRepository(gdb *gorm.DB) FollowRepository {
	return &followRepository{db: gdb, identity: NewActorIdentity(gdb)}
}

// ---------------------------------------------------------------------------
// domain.FollowRepository
// ---------------------------------------------------------------------------

func (r *followRepository) FollowingActorPTIDs(ctx context.Context, viewerPTID string) ([]string, error) {
	if viewerPTID == "" {
		return nil, nil
	}
	viewerID, err := r.identity.RequireID(ctx, viewerPTID)
	if err != nil {
		return nil, err
	}
	var ids []uint64
	err = r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ?", viewerID).
		Pluck("following_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return r.ptidSliceByID(ctx, ids)
}

func (r *followRepository) FollowerActorPTIDs(ctx context.Context, authorPTID string) ([]string, error) {
	if authorPTID == "" {
		return nil, nil
	}
	authorID, err := r.identity.RequireID(ctx, authorPTID)
	if err != nil {
		return nil, err
	}
	var ids []uint64
	err = r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("following_id = ?", authorID).
		Pluck("follower_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return r.ptidSliceByID(ctx, ids)
}

func (r *followRepository) IsFollowing(ctx context.Context, followerPTID, followingPTID string) (bool, error) {
	ids, err := r.identity.RequireIDs(ctx, []string{followerPTID, followingPTID})
	if err != nil {
		return false, err
	}
	var count int64
	err = r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ? AND following_id = ?", ids[0], ids[1]).
		Count(&count).Error
	return count > 0, err
}

// ---------------------------------------------------------------------------
// Broader RelationshipService surface
// ---------------------------------------------------------------------------

func (r *followRepository) Follow(ctx context.Context, followerPTID, followingPTID string) error {
	ids, err := r.identity.RequireIDs(ctx, []string{followerPTID, followingPTID})
	if err != nil {
		return err
	}
	followerID, followingID := ids[0], ids[1]
	if followerID == followingID {
		return gorm.ErrInvalidData
	}

	var existing db.Follow
	err = r.db.WithContext(ctx).
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

func (r *followRepository) Unfollow(ctx context.Context, followerPTID, followingPTID string) error {
	ids, err := r.identity.RequireIDs(ctx, []string{followerPTID, followingPTID})
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("follower_id = ? AND following_id = ?", ids[0], ids[1]).
			Delete(&db.Follow{}).Error; err != nil {
			return err
		}
		if err := tx.
			Where(
				"(owner_ptid = ? AND peer_ptid = ?) OR "+
					"(owner_ptid = ? AND peer_ptid = ?)",
				followerPTID,
				followingPTID,
				followingPTID,
				followerPTID,
			).
			Delete(&federatedRelationshipProjectionModel{}).Error; err != nil {
			return err
		}
		return tx.
			Where(
				"status = ? AND ((actor_ptid = ? AND peer_ptid = ?) OR "+
					"(actor_ptid = ? AND peer_ptid = ?))",
				friendRequestPolicyRelationshipAccepted,
				followerPTID,
				followingPTID,
				followingPTID,
				followerPTID,
			).
			Delete(&friendshipModel{}).Error
	})
}

func (r *followRepository) GetRelationship(ctx context.Context, followerPTID, followingPTID string) (*db.Follow, error) {
	ids, err := r.identity.RequireIDs(ctx, []string{followerPTID, followingPTID})
	if err != nil {
		return nil, err
	}
	var follow db.Follow
	err = r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id = ?", ids[0], ids[1]).
		First(&follow).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &follow, err
}

func (r *followRepository) GetFollowers(ctx context.Context, actorPTID string, c domain.Cursor, limit int) ([]*db.Follow, error) {
	actorID, err := r.identity.RequireID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	q := r.db.WithContext(ctx).
		Preload("Follower").
		Where("following_id = ?", actorID).
		Order("created_at DESC, id DESC")
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var follows []*db.Follow
	err = q.Limit(limit).Find(&follows).Error
	return follows, err
}

func (r *followRepository) GetFollowing(ctx context.Context, actorPTID string, c domain.Cursor, limit int) ([]*db.Follow, error) {
	actorID, err := r.identity.RequireID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	q := r.db.WithContext(ctx).
		Preload("Following").
		Where("follower_id = ?", actorID).
		Order("created_at DESC, id DESC")
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var follows []*db.Follow
	err = q.Limit(limit).Find(&follows).Error
	return follows, err
}

func (r *followRepository) GetFollowerCount(ctx context.Context, actorPTID string) (int64, error) {
	actorID, err := r.identity.RequireID(ctx, actorPTID)
	if err != nil {
		return 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("following_id = ?", actorID).
		Count(&count).Error
	return count, err
}

func (r *followRepository) GetFollowingCount(ctx context.Context, actorPTID string) (int64, error) {
	actorID, err := r.identity.RequireID(ctx, actorPTID)
	if err != nil {
		return 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).
		Model(&db.Follow{}).
		Where("follower_id = ?", actorID).
		Count(&count).Error
	return count, err
}

func (r *followRepository) GetRelationships(ctx context.Context, followerPTID string, targetPTIDs []string) (map[string]*db.Follow, error) {
	if len(targetPTIDs) == 0 {
		return make(map[string]*db.Follow), nil
	}
	ids, err := r.identity.RequireIDs(ctx, append([]string{followerPTID}, targetPTIDs...))
	if err != nil {
		return nil, err
	}
	followerID, targetIDs := ids[0], ids[1:]
	var follows []*db.Follow
	err = r.db.WithContext(ctx).
		Where("follower_id = ? AND following_id IN ?", followerID, targetIDs).
		Find(&follows).Error
	if err != nil {
		return nil, err
	}
	ptidsByID, err := r.ptidsByID(ctx, targetIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[string]*db.Follow, len(follows))
	for _, f := range follows {
		out[ptidsByID[f.FollowingID]] = f
	}
	return out, nil
}

func (r *followRepository) GetReverseRelationships(ctx context.Context, followingPTID string, followerPTIDs []string) (map[string]bool, error) {
	out := make(map[string]bool)
	if followingPTID == "" || len(followerPTIDs) == 0 {
		return out, nil
	}
	ids, err := r.identity.RequireIDs(ctx, append([]string{followingPTID}, followerPTIDs...))
	if err != nil {
		return nil, err
	}
	followingID, followerIDs := ids[0], ids[1:]
	var follows []*db.Follow
	err = r.db.WithContext(ctx).
		Where("following_id = ? AND follower_id IN ?", followingID, followerIDs).
		Find(&follows).Error
	if err != nil {
		return nil, err
	}
	ptidsByID, err := r.ptidsByID(ctx, followerIDs)
	if err != nil {
		return nil, err
	}
	for _, f := range follows {
		out[ptidsByID[f.FollowerID]] = true
	}
	return out, nil
}

func (r *followRepository) ptidsByID(ctx context.Context, actorIDs []uint64) (map[uint64]string, error) {
	var actors []db.Actor
	if err := r.db.WithContext(ctx).
		Select("id", "ptid").
		Where("id IN ?", actorIDs).
		Find(&actors).Error; err != nil {
		return nil, err
	}
	result := make(map[uint64]string, len(actors))
	for _, actor := range actors {
		result[actor.ID] = actor.PTID
	}
	return result, nil
}

func (r *followRepository) ptidSliceByID(ctx context.Context, actorIDs []uint64) ([]string, error) {
	ptidsByID, err := r.ptidsByID(ctx, actorIDs)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(actorIDs))
	for _, actorID := range actorIDs {
		if ptid := ptidsByID[actorID]; ptid != "" {
			result = append(result, ptid)
		}
	}
	return result, nil
}
