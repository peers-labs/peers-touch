package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
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
// per actor this completes in <10ms. The persistence adapter owns those
// queries so numeric actor keys never enter this layer.
type StatsService struct {
	repos *infrastructure.Repos
}

func NewStatsService(repos *infrastructure.Repos) *StatsService {
	return &StatsService{repos: repos}
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

// MyStats computes every counter for `actorPTID`. Errors on individual
// counters degrade to zero so a single failing query doesn't blank
// the whole panel — we log a warning and proceed. This is the
// trade-off the dashboard makes: a slightly stale "0 followers"
// during a transient DB hiccup is preferable to an empty panel.
func (s *StatsService) MyStats(ctx context.Context, actorPTID string) (*MomentsStats, error) {
	persisted, err := s.repos.Stats.GetByActorPTID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	stats := &MomentsStats{
		PostsCount:             persisted.PostsCount,
		CommentsCount:          persisted.CommentsCount,
		ReactionsGivenCount:    persisted.ReactionsGivenCount,
		CommentsReceivedCount:  persisted.CommentsReceivedCount,
		ReactionsReceivedCount: persisted.ReactionsReceivedCount,
		CirclesCount:           persisted.CirclesCount,
	}

	if c, err := s.repos.Follows.GetFollowingCount(ctx, actorPTID); err == nil {
		stats.FollowingCount = c
	} else {
		logger.Warn(ctx, "stats: following count failed", "error", err)
	}
	if c, err := s.repos.Follows.GetFollowerCount(ctx, actorPTID); err == nil {
		stats.FollowersCount = c
	} else {
		logger.Warn(ctx, "stats: followers count failed", "error", err)
	}

	return stats, nil
}
