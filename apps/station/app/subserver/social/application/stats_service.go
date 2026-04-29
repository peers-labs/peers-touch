package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// StatsService computes the aggregate counters that power the
// user-side Moments dashboard panel. The shape is intentionally
// lightweight — every value is a single SQL aggregate so the entire
// snapshot fits in one network round-trip from the desktop.
//
// Why not just denormalised columns? Because the dashboard needs
// cross-table sums (e.g. comments-on-my-posts spans both
// social_public_posts and social_private_posts), and pinning a
// per-actor materialised view would be premature optimisation when
// the active user count is small. The queries below are individually
// O(rows-by-author) on indexed columns; on a station with 10k posts
// per actor this completes in <10ms.
type StatsService struct {
	db    *gorm.DB
	repos *infrastructure.Repos
}

func NewStatsService(db *gorm.DB, repos *infrastructure.Repos) *StatsService {
	return &StatsService{db: db, repos: repos}
}

// MomentsStats is a value object — the application layer's mirror of
// `model.GetMyMomentsStatsResponse`. The handler maps it to the
// proto without further logic.
type MomentsStats struct {
	PostsCount             int64
	CommentsCount          int64
	ReactionsGivenCount    int64
	CommentsReceivedCount  int64
	ReactionsReceivedCount int64
	FollowingCount         int64
	FollowersCount         int64
	CirclesCount           int64
}

// MyStats computes every counter for `userID`. Errors on individual
// counters degrade to zero so a single failing query doesn't blank
// the whole panel — we log a warning and proceed. This is the
// trade-off the dashboard makes: a slightly stale "0 followers"
// during a transient DB hiccup is preferable to an empty panel.
func (s *StatsService) MyStats(ctx context.Context, userID uint64) (*MomentsStats, error) {
	stats := &MomentsStats{}

	pubPosts, err := s.countAuthorPosts(ctx, userID, &db.SocialPublicPost{})
	if err != nil {
		logger.Warn(ctx, "stats: count public posts failed", "error", err, "user_id", userID)
	}
	privPosts, err := s.countAuthorPosts(ctx, userID, &db.SocialPrivatePost{})
	if err != nil {
		logger.Warn(ctx, "stats: count private posts failed", "error", err, "user_id", userID)
	}
	stats.PostsCount = pubPosts + privPosts

	if c, err := s.countByColumn(ctx, &db.SocialComment{}, "author_id = ? AND deleted_at IS NULL", userID); err == nil {
		stats.CommentsCount = c
	} else {
		logger.Warn(ctx, "stats: count my comments failed", "error", err, "user_id", userID)
	}

	if c, err := s.countByColumn(ctx, &db.SocialReaction{}, "user_id = ?", userID); err == nil {
		stats.ReactionsGivenCount = c
	} else {
		logger.Warn(ctx, "stats: count my reactions failed", "error", err, "user_id", userID)
	}

	pubReceived, err := s.sumAuthorComments(ctx, userID, &db.SocialPublicPost{})
	if err != nil {
		logger.Warn(ctx, "stats: sum public comments-received failed", "error", err, "user_id", userID)
	}
	privReceived, err := s.sumAuthorComments(ctx, userID, &db.SocialPrivatePost{})
	if err != nil {
		logger.Warn(ctx, "stats: sum private comments-received failed", "error", err, "user_id", userID)
	}
	stats.CommentsReceivedCount = pubReceived + privReceived

	stats.ReactionsReceivedCount = s.countReactionsReceived(ctx, userID)

	if c, err := s.repos.Follows.GetFollowingCount(ctx, userID); err == nil {
		stats.FollowingCount = c
	} else {
		logger.Warn(ctx, "stats: following count failed", "error", err, "user_id", userID)
	}
	if c, err := s.repos.Follows.GetFollowerCount(ctx, userID); err == nil {
		stats.FollowersCount = c
	} else {
		logger.Warn(ctx, "stats: followers count failed", "error", err, "user_id", userID)
	}

	if c, err := s.countByColumn(ctx, &db.SocialCircle{}, "owner_id = ? AND deleted_at IS NULL", userID); err == nil {
		stats.CirclesCount = c
	} else {
		logger.Warn(ctx, "stats: circles count failed", "error", err, "user_id", userID)
	}

	return stats, nil
}

func (s *StatsService) countAuthorPosts(ctx context.Context, userID uint64, table any) (int64, error) {
	var n int64
	err := s.db.WithContext(ctx).
		Model(table).
		Where("author_id = ? AND deleted_at IS NULL", userID).
		Count(&n).Error
	return n, err
}

// countByColumn is a tiny generic count helper to avoid repeating
// the GORM ceremony for every counter.
func (s *StatsService) countByColumn(ctx context.Context, table any, where string, args ...any) (int64, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(table).Where(where, args...).Count(&n).Error
	return n, err
}

// sumAuthorComments folds the denormalised `comments_count` column
// across all live posts authored by `userID`. The COALESCE wrapper
// handles the empty-result-set case where SUM returns NULL.
func (s *StatsService) sumAuthorComments(ctx context.Context, userID uint64, table any) (int64, error) {
	var n int64
	err := s.db.WithContext(ctx).
		Model(table).
		Where("author_id = ? AND deleted_at IS NULL", userID).
		Select("COALESCE(SUM(comments_count), 0)").
		Scan(&n).Error
	return n, err
}

// countReactionsReceived counts reactions whose target post was
// authored by `userID`. We deliberately ignore SocialReaction's
// foreign-key relationships (that table doesn't carry a denormalised
// `target_author_id` column) and instead do two scoped queries
// joined through the post tables. Returns 0 on failure to keep the
// dashboard rendering.
func (s *StatsService) countReactionsReceived(ctx context.Context, userID uint64) int64 {
	var n int64
	if err := s.db.WithContext(ctx).
		Table("social_reactions AS r").
		Joins("JOIN social_public_posts AS p ON p.id = r.post_id AND p.author_id = ? AND p.deleted_at IS NULL", userID).
		Where("r.user_id <> ?", userID).
		Count(&n).Error; err != nil {
		logger.Warn(ctx, "stats: count public reactions-received failed", "error", err, "user_id", userID)
		n = 0
	}
	var m int64
	if err := s.db.WithContext(ctx).
		Table("social_reactions AS r").
		Joins("JOIN social_private_posts AS p ON p.id = r.post_id AND p.author_id = ? AND p.deleted_at IS NULL", userID).
		Where("r.user_id <> ?", userID).
		Count(&m).Error; err != nil {
		logger.Warn(ctx, "stats: count private reactions-received failed", "error", err, "user_id", userID)
		m = 0
	}
	return n + m
}
