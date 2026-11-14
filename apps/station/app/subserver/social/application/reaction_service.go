package application

import (
	"context"
	"sort"
	"strings"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// ReactionService derives viewer-bound summaries. Writes belong to the signed
// public Feed and private interaction command owners.
type ReactionService struct {
	repos *infrastructure.Repos
}

func NewReactionService(repos *infrastructure.Repos) *ReactionService {
	return &ReactionService{repos: repos}
}

// Aggregate returns the reaction summaries for a post, with the
// viewer-bound `reacted_by_viewer` flag populated. Callers that don't
// need the viewer-bound flag may pass viewerID = 0.
func (s *ReactionService) Aggregate(ctx context.Context, postID string, postAuthorPTID, viewerPTID string) ([]domain.ReactionSummary, error) {
	reactions, err := s.repos.Reactions.ListByPost(ctx, postID)
	if err != nil {
		return nil, err
	}
	return s.summarizeVisible(ctx, reactions, postAuthorPTID, viewerPTID)
}

func (s *ReactionService) summarizeVisible(
	ctx context.Context,
	reactions []domain.Reaction,
	postAuthorPTID string,
	viewerPTID string,
) ([]domain.ReactionSummary, error) {
	if len(reactions) == 0 {
		return []domain.ReactionSummary{}, nil
	}
	canSeeActor, err := s.reactionActorVisibility(ctx, reactions, postAuthorPTID, viewerPTID)
	if err != nil {
		return nil, err
	}
	return summarizeReactions(reactions, viewerPTID, canSeeActor), nil
}

func (s *ReactionService) reactionActorVisibility(
	ctx context.Context, reactions []domain.Reaction, postAuthorPTID, viewerPTID string,
) (func(string) bool, error) {
	visibility, err := buildInteractionVisibility(ctx, s.repos, viewerPTID, postAuthorPTID)
	if err != nil {
		return nil, err
	}
	ptids := make([]string, 0, len(reactions))
	for _, reaction := range reactions {
		ptids = append(ptids, reaction.ActorPTID)
	}
	blocked, err := blockedActorPTIDs(ctx, s.repos, viewerPTID, ptids)
	if err != nil {
		return nil, err
	}
	authors, err := s.repos.Identity.ActorsByPTIDs(ctx, ptids)
	if err != nil {
		return nil, err
	}
	domains, peers := make([]string, 0, len(authors)), make([]string, 0, len(authors))
	for _, author := range authors {
		domains = append(domains, author.HomeStationDomain)
		peers = append(peers, author.HomeStationPeerID)
	}
	blockedDomains, blockedPeers, err := s.repos.Moderation.BlockedStations(ctx, domains, peers)
	if err != nil {
		return nil, err
	}
	return func(ptid string) bool {
		author := authors[ptid]
		return author != nil && !blocked[ptid] && visibility.CanSeeActor(ptid) &&
			!blockedDomains[strings.TrimSpace(author.HomeStationDomain)] &&
			!blockedPeers[strings.TrimSpace(author.HomeStationPeerID)]
	}, nil
}

// AggregateComments reads one bounded target page, sharing the same actor
// visibility decision across every comment and reply in the page.
func (s *ReactionService) AggregateComments(ctx context.Context, postID, postAuthorPTID, viewerPTID string, commentIDs []string) (map[string][]domain.ReactionSummary, error) {
	byComment, err := s.repos.Reactions.ListByComments(ctx, postID, commentIDs)
	if err != nil {
		return nil, err
	}
	all := make([]domain.Reaction, 0)
	for _, reactions := range byComment {
		all = append(all, reactions...)
	}
	if len(all) == 0 {
		return map[string][]domain.ReactionSummary{}, nil
	}
	canSeeActor, err := s.reactionActorVisibility(ctx, all, postAuthorPTID, viewerPTID)
	if err != nil {
		return nil, err
	}
	out := make(map[string][]domain.ReactionSummary, len(byComment))
	for commentID, reactions := range byComment {
		out[commentID] = summarizeReactions(reactions, viewerPTID, canSeeActor)
	}
	return out, nil
}

func summarizeReactions(reactions []domain.Reaction, viewerPTID string, canSeeActor func(string) bool) []domain.ReactionSummary {
	counts := make(map[model.ReactionKind]int64)
	reacted := make(map[model.ReactionKind]bool)
	for _, reaction := range reactions {
		if !canSeeActor(reaction.ActorPTID) {
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
	return out
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
