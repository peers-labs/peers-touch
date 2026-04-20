// Package application — OverviewService aggregates statistics from across
// the Station for the dashboard overview page.
//
// Change History:
// - 2026-04-10: Initial implementation — full statistics aggregation.
// - 2026-04-10: Refactored from flat overview.go into DDD application layer.
// - 2026-04-10: GetRecentActors now returns []domain.ActorSummary instead of
//   raw touchdb.Actor to prevent leaking PasswordHash, PrivateKey, PublicKey.
// - 2026-04-10: Removed fake/unsupported fields — sessions stats, storage stats,
//   hardcoded version, empty node_name, nodes.online (was always == registered).
package application

import (
	"context"
	"runtime"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// OverviewService collects runtime statistics for the dashboard overview page.
type OverviewService struct {
	actorRepo infrastructure.ActorQueryRepository
	auditRepo infrastructure.AuditRepository
	registry  registry.Registry
}

// NewOverviewService constructs an OverviewService.
func NewOverviewService(
	actorRepo infrastructure.ActorQueryRepository,
	auditRepo infrastructure.AuditRepository,
	reg registry.Registry,
) *OverviewService {
	return &OverviewService{
		actorRepo: actorRepo,
		auditRepo: auditRepo,
		registry:  reg,
	}
}

// SetRegistry allows late-binding the registry after construction.
func (s *OverviewService) SetRegistry(reg registry.Registry) {
	s.registry = reg
}

// GetOverview collects all overview statistics in a single call.
func (s *OverviewService) GetOverview(ctx context.Context, subservers []server.Subserver, startedAt time.Time, listenAddr string) (*domain.OverviewStats, error) {
	stats := &domain.OverviewStats{}
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekStart := todayStart.AddDate(0, 0, -int(now.Weekday()))

	// -- Actor stats --
	stats.Actors.Total, _ = s.actorRepo.CountActors(ctx)
	stats.Actors.NewToday, _ = s.actorRepo.CountActorsSince(ctx, todayStart)
	stats.Actors.NewThisWeek, _ = s.actorRepo.CountActorsSince(ctx, weekStart)
	stats.Actors.Active, _ = s.actorRepo.CountOnlineActors(ctx)

	// -- Node stats via registry --
	if s.registry != nil {
		peers, err := s.registry.Query(ctx)
		if err == nil {
			stats.Nodes.Registered = len(peers)
		}
	}

	// -- SubServer stats --
	for _, sub := range subservers {
		info := domain.SubServerInfo{
			Name:   sub.Name(),
			Type:   string(sub.Type()),
			Status: string(sub.Status()),
		}
		stats.SubServers.List = append(stats.SubServers.List, info)
		stats.SubServers.Total++
		if sub.Status().IsRunning() {
			stats.SubServers.Running++
		} else {
			stats.SubServers.Stopped++
		}
	}

	// -- Social stats --
	stats.Social.TotalPosts, _ = s.actorRepo.CountPosts(ctx)
	stats.Social.TotalComments, _ = s.actorRepo.CountComments(ctx)
	stats.Social.TotalLikes, _ = s.actorRepo.CountLikes(ctx)
	stats.Social.TotalFollows, _ = s.actorRepo.CountFollows(ctx)
	stats.Social.PostsToday, _ = s.actorRepo.CountPostsSince(ctx, todayStart)

	// -- System info (only real runtime data) --
	stats.System = domain.SystemInfo{
		StartedAt:  startedAt,
		GoVersion:  runtime.Version(),
		ListenAddr: listenAddr,
	}

	return stats, nil
}

// GetRecentActors returns the N most recently registered actors as safe
// ActorSummary projections, stripping all sensitive fields (PasswordHash,
// PrivateKey, PublicKey, etc.) before they leave the application layer.
func (s *OverviewService) GetRecentActors(ctx context.Context, limit int) ([]domain.ActorSummary, error) {
	actors, err := s.actorRepo.RecentActors(ctx, limit)
	if err != nil {
		return nil, err
	}

	summaries := make([]domain.ActorSummary, 0, len(actors))
	for _, a := range actors {
		summaries = append(summaries, domain.ActorSummary{
			ID:               a.ID,
			DID:              a.PTID,
			PreferredUsername: a.PreferredUsername,
			Name:             a.Name,
			Email:            a.Email,
			Summary:          a.Summary,
			AvatarURL:        a.Icon,
			CreatedAt:        a.CreatedAt,
		})
	}

	return summaries, nil
}

// GetRecentAuditLogs returns the N most recent dashboard audit logs.
func (s *OverviewService) GetRecentAuditLogs(ctx context.Context, limit int) ([]domain.DashboardAuditLog, error) {
	return s.auditRepo.ListRecent(ctx, limit)
}
