// Package application — ActorService provides management operations for
// Peers actors from the dashboard admin perspective.
//
// Change History:
// - 2026-04-10: Initial implementation — list, detail, password reset,
//   session management with enriched actor details.
// - 2026-04-10: Refactored from flat actors_service.go into DDD application layer.
package application

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// ActorService encapsulates actor queries and management.
type ActorService struct {
	actorRepo infrastructure.ActorQueryRepository
}

// NewActorService constructs an ActorService.
func NewActorService(actorRepo infrastructure.ActorQueryRepository) *ActorService {
	return &ActorService{actorRepo: actorRepo}
}

// ListActors returns paginated actors with optional search filter.
func (s *ActorService) ListActors(ctx context.Context, query domain.ActorListQuery) (*domain.ActorListResult, error) {
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.PageSize <= 0 || query.PageSize > 100 {
		query.PageSize = 20
	}

	actors, total, err := s.actorRepo.ListActors(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list actors: %w", err)
	}

	items := make([]domain.ActorDetail, 0, len(actors))
	for _, a := range actors {
		items = append(items, s.enrichActorDetail(ctx, a))
	}

	return &domain.ActorListResult{
		Total: total,
		Page:  query.Page,
		Items: items,
	}, nil
}

// GetActorDetail returns enriched information about a single actor.
func (s *ActorService) GetActorDetail(ctx context.Context, actorID uint64) (*domain.ActorDetail, error) {
	actor, err := s.actorRepo.FindActorByID(ctx, actorID)
	if err != nil {
		return nil, fmt.Errorf("actor not found: %w", err)
	}

	detail := s.enrichActorDetail(ctx, *actor)
	return &detail, nil
}

// enrichActorDetail populates counts and status for a single actor row.
func (s *ActorService) enrichActorDetail(ctx context.Context, a touchdb.Actor) domain.ActorDetail {
	detail := domain.ActorDetail{
		ID:               a.ID,
		DID:              a.PTID,
		PreferredUsername: a.PreferredUsername,
		Name:             a.Name,
		Email:            a.Email,
		Summary:          a.Summary,
		AvatarURL:        a.Icon,
		CreatedAt:        a.CreatedAt,
	}

	// Resolve online status
	actorStatus, err := s.actorRepo.GetActorStatus(ctx, a.ID)
	if err == nil {
		switch actorStatus.Status {
		case touchdb.ActorStatusOnline:
			detail.Status = "online"
		case touchdb.ActorStatusAway:
			detail.Status = "away"
		default:
			detail.Status = "offline"
		}
	} else {
		detail.Status = "offline"
	}

	// Social counters
	detail.PostCount, _ = s.actorRepo.CountPostsByAuthor(ctx, a.ID)
	detail.FollowerCount, _ = s.actorRepo.CountFollowers(ctx, a.ID)
	detail.FollowingCount, _ = s.actorRepo.CountFollowing(ctx, a.ID)

	return detail
}

// ResetActorPassword resets an actor's password (admin operation).
func (s *ActorService) ResetActorPassword(ctx context.Context, actorID uint64, newPassword string) error {
	hash, err := domain.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	if err := s.actorRepo.ResetPassword(ctx, actorID, hash); err != nil {
		return err
	}

	log.Infof(ctx, "[dashboard] actor %d password reset by admin", actorID)
	return nil
}

// GetActorSessions returns sessions for a specific actor.
func (s *ActorService) GetActorSessions(ctx context.Context, actorID uint64) ([]domain.ActorSessionInfo, error) {
	return s.actorRepo.ListActorSessions(ctx, actorID)
}

// RevokeActorSession revokes a specific actor session by session ID.
func (s *ActorService) RevokeActorSession(ctx context.Context, sessionID string) error {
	return s.actorRepo.RevokeActorSession(ctx, sessionID)
}
