package infrastructure

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type momentsStatsRepo struct {
	db       *gorm.DB
	identity *ActorIdentity
}

func NewMomentsStatsRepository(gdb *gorm.DB, identity *ActorIdentity) domain.MomentsStatsRepository {
	return &momentsStatsRepo{
		db:       gdb,
		identity: identity,
	}
}

func (r *momentsStatsRepo) GetByActorPTID(ctx context.Context, actorPTID string) (domain.MomentsStatsSnapshot, error) {
	authorID, err := r.identity.RequireID(ctx, actorPTID)
	if err != nil {
		return domain.MomentsStatsSnapshot{}, fmt.Errorf("resolve stats actor PTID: %w", err)
	}

	var stats domain.MomentsStatsSnapshot
	publicPosts, err := r.countAuthorPosts(ctx, authorID, &db.SocialPublicPost{})
	if err != nil {
		logger.Warn(ctx, "stats: count public posts failed", "error", err, "author_ptid", actorPTID)
	}
	privatePosts, err := r.countAuthorPosts(ctx, authorID, &db.SocialPrivatePost{})
	if err != nil {
		logger.Warn(ctx, "stats: count private posts failed", "error", err, "author_ptid", actorPTID)
	}
	stats.PostsCount = publicPosts + privatePosts

	if count, err := r.countByColumn(ctx, &db.SocialComment{}, "author_id = ? AND deleted_at IS NULL", authorID); err == nil {
		stats.CommentsCount = count
	} else {
		logger.Warn(ctx, "stats: count my comments failed", "error", err, "author_ptid", actorPTID)
	}

	if count, err := r.countByColumn(ctx, &db.SocialReaction{}, "actor_id = ?", authorID); err == nil {
		stats.ReactionsGivenCount = count
	} else {
		logger.Warn(ctx, "stats: count my reactions failed", "error", err, "author_ptid", actorPTID)
	}

	publicComments, err := r.sumAuthorComments(ctx, authorID, &db.SocialPublicPost{})
	if err != nil {
		logger.Warn(ctx, "stats: sum public comments-received failed", "error", err, "author_ptid", actorPTID)
	}
	privateComments, err := r.sumAuthorComments(ctx, authorID, &db.SocialPrivatePost{})
	if err != nil {
		logger.Warn(ctx, "stats: sum private comments-received failed", "error", err, "author_ptid", actorPTID)
	}
	stats.CommentsReceivedCount = publicComments + privateComments
	stats.ReactionsReceivedCount = r.countReactionsReceived(ctx, authorID, actorPTID)

	if count, err := r.countByColumn(ctx, &db.SocialCircle{}, "owner_id = ? AND deleted_at IS NULL", authorID); err == nil {
		stats.CirclesCount = count
	} else {
		logger.Warn(ctx, "stats: circles count failed", "error", err, "author_ptid", actorPTID)
	}

	return stats, nil
}

func (r *momentsStatsRepo) countAuthorPosts(ctx context.Context, authorID uint64, table any) (int64, error) {
	return r.countByColumn(ctx, table, "author_id = ? AND deleted_at IS NULL", authorID)
}

func (r *momentsStatsRepo) countByColumn(ctx context.Context, table any, where string, args ...any) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(table).Where(where, args...).Count(&count).Error
	return count, err
}

func (r *momentsStatsRepo) sumAuthorComments(ctx context.Context, authorID uint64, table any) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(table).
		Where("author_id = ? AND deleted_at IS NULL", authorID).
		Select("COALESCE(SUM(comments_count), 0)").
		Scan(&count).Error
	return count, err
}

func (r *momentsStatsRepo) countReactionsReceived(ctx context.Context, authorID uint64, actorPTID string) int64 {
	var publicCount int64
	if err := r.db.WithContext(ctx).
		Table("social_reactions AS r").
		Joins("JOIN social_public_posts AS p ON p.id = r.post_id AND p.author_id = ? AND p.deleted_at IS NULL", authorID).
		Where("r.actor_id <> ?", authorID).
		Count(&publicCount).Error; err != nil {
		logger.Warn(ctx, "stats: count public reactions-received failed", "error", err, "author_ptid", actorPTID)
		publicCount = 0
	}

	var privateCount int64
	if err := r.db.WithContext(ctx).
		Table("social_reactions AS r").
		Joins("JOIN social_private_posts AS p ON p.id = r.post_id AND p.author_id = ? AND p.deleted_at IS NULL", authorID).
		Where("r.actor_id <> ?", authorID).
		Count(&privateCount).Error; err != nil {
		logger.Warn(ctx, "stats: count private reactions-received failed", "error", err, "author_ptid", actorPTID)
		privateCount = 0
	}

	return publicCount + privateCount
}
