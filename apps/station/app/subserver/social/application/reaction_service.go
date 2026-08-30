package application

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// ReactionService handles typed reactions (LIKE / LOVE / LAUGH / WOW /
// CELEBRATE — see `model.ReactionKind`). Toggling a reaction also
// updates the parent post's denormalised `reactions_count_json`
// snapshot so list queries don't pay an N+1 aggregation cost.
type ReactionService struct {
	repos     *infrastructure.Repos
	gdb       *gorm.DB
	publisher *MomentEventPublisher
}

// NewReactionService takes both the repo bundle (for high-level
// operations) AND the bare *gorm.DB (for the post-class lookup which
// MUST bypass the viewer-bound visibility filter — class
// identification is a storage concern, not an authorisation one).
func NewReactionService(gdb *gorm.DB, repos *infrastructure.Repos, publishers ...*MomentEventPublisher) *ReactionService {
	var publisher *MomentEventPublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &ReactionService{repos: repos, gdb: gdb, publisher: publisher}
}

// React records `(post, viewer, kind)` and refreshes the post's
// reaction snapshot. Idempotent at the (post,viewer,kind) composite
// key level — re-reacting with the same kind is a no-op.
//
// Visibility is implicitly enforced because the parent post must be
// readable to land here — the handler calls MomentService.GetMoment
// first; if that returns nil the reaction is rejected upstream.
func (s *ReactionService) React(ctx context.Context, postIDStr, viewerPTID string, kind model.ReactionKind) ([]*model.ReactionSummary, error) {
	postID, postAuthorPTID, postClass, err := s.resolvePostMeta(ctx, postIDStr, viewerPTID)
	if err != nil {
		return nil, err
	}
	if postID == 0 {
		return nil, fmt.Errorf("post %s not found", postIDStr)
	}
	if viewerPTID == "" {
		return nil, fmt.Errorf("authentication required to react")
	}
	if kind == model.ReactionKind_REACTION_UNSPECIFIED {
		return nil, fmt.Errorf("reaction kind is required")
	}

	if err := s.repos.Reactions.Add(ctx, &domain.Reaction{
		PostID:    postID,
		PostClass: postClass,
		ActorPTID: viewerPTID,
		Kind:      kind,
	}); err != nil {
		return nil, fmt.Errorf("add reaction: %w", err)
	}

	if err := s.refreshSnapshot(ctx, postID, postClass); err != nil {
		logger.Warn(ctx, "react: snapshot refresh failed", "post_id", postID, "error", err)
	}

	summaries, err := s.Aggregate(ctx, postID, postAuthorPTID, viewerPTID)
	if err != nil {
		return nil, err
	}
	if s.publisher != nil {
		s.publisher.PublishReacted(ctx, postID, viewerPTID, kind, false)
	}
	return s.toProtoSummaries(summaries), nil
}

// Unreact removes `(post, viewer, kind)` and refreshes the snapshot.
// No-op if the row doesn't exist.
func (s *ReactionService) Unreact(ctx context.Context, postIDStr, viewerPTID string, kind model.ReactionKind) ([]*model.ReactionSummary, error) {
	postID, postAuthorPTID, postClass, err := s.resolvePostMeta(ctx, postIDStr, viewerPTID)
	if err != nil {
		return nil, err
	}
	if postID == 0 {
		return nil, fmt.Errorf("post %s not found", postIDStr)
	}
	if viewerPTID == "" {
		return nil, fmt.Errorf("authentication required to unreact")
	}

	if err := s.repos.Reactions.Remove(ctx, postID, viewerPTID, kind.String()); err != nil {
		return nil, fmt.Errorf("remove reaction: %w", err)
	}

	if err := s.refreshSnapshot(ctx, postID, postClass); err != nil {
		logger.Warn(ctx, "unreact: snapshot refresh failed", "post_id", postID, "error", err)
	}

	summaries, err := s.Aggregate(ctx, postID, postAuthorPTID, viewerPTID)
	if err != nil {
		return nil, err
	}
	if s.publisher != nil {
		s.publisher.PublishReacted(ctx, postID, viewerPTID, kind, true)
	}
	return s.toProtoSummaries(summaries), nil
}

// Aggregate returns the reaction summaries for a post, with the
// viewer-bound `reacted_by_viewer` flag populated. Callers that don't
// need the viewer-bound flag may pass viewerID = 0.
func (s *ReactionService) Aggregate(ctx context.Context, postID uint64, postAuthorPTID, viewerPTID string) ([]domain.ReactionSummary, error) {
	reactions, err := s.repos.Reactions.ListByPost(ctx, postID)
	if err != nil {
		return nil, err
	}
	visibility, err := buildInteractionVisibility(ctx, s.repos, viewerPTID, postAuthorPTID)
	if err != nil {
		return nil, err
	}
	counts := make(map[model.ReactionKind]int64)
	reacted := make(map[model.ReactionKind]bool)
	for _, reaction := range reactions {
		if !visibility.CanSeeActor(reaction.ActorPTID) {
			continue
		}
		counts[reaction.Kind] += 1
		if viewerPTID != "" && reaction.ActorPTID == viewerPTID {
			reacted[reaction.Kind] = true
		}
	}
	kinds := make([]int, 0, len(counts))
	for kind := range counts {
		kinds = append(kinds, int(kind))
	}
	sort.Ints(kinds)
	out := make([]domain.ReactionSummary, 0, len(kinds))
	for _, kindValue := range kinds {
		kind := model.ReactionKind(kindValue)
		out = append(out, domain.ReactionSummary{
			Kind:            kind,
			Count:           counts[kind],
			ReactedByViewer: reacted[kind],
		})
	}
	return out, nil
}

// resolvePostMeta looks up the post's storage class without applying
// the per-viewer visibility filter — class identification is an
// internal storage concern, NOT an authorisation decision (the
// authorisation gate is the handler's responsibility before calling
// React/Unreact). We therefore query the underlying tables directly
// rather than going through `PrivatePosts.GetByID` whose viewer-bound
// filter would strip SELF posts when called with `viewerID == 0`.
func (s *ReactionService) resolvePostMeta(ctx context.Context, postIDStr, viewerPTID string) (uint64, string, domain.PostClass, error) {
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return 0, "", "", fmt.Errorf("invalid post_id %q", postIDStr)
	}

	pub, err := s.repos.PublicPosts.GetByID(ctx, postID)
	if err != nil {
		return 0, "", "", err
	}
	if pub != nil {
		return postID, pub.AuthorPTID, domain.PostClassPublic, nil
	}
	priv, err := s.repos.PrivatePosts.GetByID(ctx, postID, viewerPTID)
	if err != nil {
		return 0, "", "", err
	}
	if priv != nil {
		return postID, priv.AuthorPTID, domain.PostClassPrivate, nil
	}
	return 0, "", "", nil
}

func (s *ReactionService) refreshSnapshot(ctx context.Context, postID uint64, class domain.PostClass) error {
	summaries, err := s.repos.Reactions.Aggregate(ctx, postID)
	if err != nil {
		return err
	}
	snapshot := make(map[string]int64, len(summaries))
	for _, s := range summaries {
		snapshot[s.Kind.String()] = s.Count
	}
	b, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	switch class {
	case domain.PostClassPublic:
		return s.repos.PublicPosts.UpdateReactionsCount(ctx, postID, string(b))
	case domain.PostClassPrivate:
		return s.repos.PrivatePosts.UpdateReactionsCount(ctx, postID, string(b))
	default:
		return fmt.Errorf("unknown post class %q", class)
	}
}

func (s *ReactionService) toProtoSummaries(in []domain.ReactionSummary) []*model.ReactionSummary {
	out := make([]*model.ReactionSummary, 0, len(in))
	for _, x := range in {
		out = append(out, &model.ReactionSummary{
			Kind:            x.Kind,
			Count:           x.Count,
			ReactedByViewer: x.ReactedByViewer,
		})
	}
	return out
}
