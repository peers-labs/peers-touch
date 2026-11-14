package application

import (
	"context"
	"fmt"
	"strconv"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// MomentService is the application-layer entry point for the Moments
// surface. It owns the cross-cutting concerns the domain layer keeps
// out of `CanRead` / `ValidateForAuthor`:
//
//   - Resolving viewer relationship state into a `domain.Viewer` so
//     `CanRead` can be invoked with pure inputs.
// Public mutations belong to FeedLogService and FeedProjector; private
// mutations belong to the Secure Content pipeline. This service reads and
// hydrates existing public projections.
//
// Stat hydration (author info, reactions snapshot, viewer interaction)
// happens here too — converters return Posts with empty `Author /
// Reactions / Interaction` and the application service fills those
// in via batch lookups so the converter stays storage-agnostic.
type MomentService struct {
	db        *gorm.DB
	repos     *infrastructure.Repos
	conv      *domain.PostConverter
	resolver  domain.ActorResolver
	groups    domain.GroupMembershipChecker
	media     domain.MediaResolver
	reactions *ReactionService
	publisher *MomentEventPublisher
}

// NewMomentService wires the moment service against the supplied
// dependencies. The reaction service is injected (rather than
// constructed inside) because both services need to stay in sync
// when reactions land on a post — the reaction service updates the
// post's denormalised reactions JSON snapshot, the moment service
// reads it during hydration.
func NewMomentService(
	gdb *gorm.DB,
	repos *infrastructure.Repos,
	resolver domain.ActorResolver,
	groups domain.GroupMembershipChecker,
	media domain.MediaResolver,
	reactions *ReactionService,
	publishers ...*MomentEventPublisher,
) *MomentService {
	if media == nil {
		// Defensive: callers should always supply a resolver, but
		// preserve the P1 behavior (accept everything) rather than
		// panic if the wiring forgets to plumb it through.
		media = NewNoopMediaResolver()
	}
	var publisher *MomentEventPublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &MomentService{
		db:        gdb,
		repos:     repos,
		conv:      domain.NewPostConverter(),
		resolver:  resolver,
		groups:    groups,
		media:     media,
		reactions: reactions,
		publisher: publisher,
	}
}

// validateAttachmentCIDs runs the per-content-type cap + MediaResolver
// gate before we start converting to domain.Post. The gate exists so
// the timeline never references foreign-origin or fabricated keys —
// see `domain.MediaResolver` for the full threat model.
//
// Counts only — actual byte-level validation (dimensions, EXIF, etc.)
// happens at upload time inside the OSS subserver. The social
// subserver trusts that anything in `oss_files` is well-formed.
func (s *MomentService) validateAttachmentCIDs(ctx context.Context, req *model.CreatePostRequest) error {
	return domain.ValidatePostMedia(ctx, req, s.media)
}

// assertAudienceTargetReachable enforces the cross-subserver pre-flight
// checks that ValidateForAuthor intentionally skips:
//
//   - CIRCLE: the target circle must exist and be owned by the author.
//   - GROUP: the author must be a member of the target group.
//
// FOLLOWERS / SELF / PUBLIC / CUSTOM_* don't need a target lookup.
func (s *MomentService) assertAudienceTargetReachable(ctx context.Context, authorPTID string, a *model.Audience) error {
	switch a.Kind {
	case model.Audience_CIRCLE:
		circleID := a.GetCircleId()
		c, err := s.repos.Circles.GetByID(ctx, circleID)
		if err != nil {
			return fmt.Errorf("lookup circle %d: %w", circleID, err)
		}
		if c == nil || c.OwnerPTID != authorPTID {
			return fmt.Errorf("circle %d does not exist or is not owned by author", circleID)
		}

	case model.Audience_GROUP:
		conversationID := a.GetGroupConversationId()
		isMember, err := s.groups.IsMember(ctx, conversationID, authorPTID)
		if err != nil {
			return fmt.Errorf("lookup group membership: %w", err)
		}
		if !isMember {
			return fmt.Errorf(
				"author is not a member of group %q (or Conversation subserver is unavailable)",
				conversationID,
			)
		}
	}
	return nil
}

// GetMoment returns a single public moment with viewer-bound visibility
// applied. Legacy private posts are no longer reachable after the W11
// hard-cut; new private content is served through the Secure Content
// pipeline (GetPrivateMoment / GetMomentResource).
func (s *MomentService) GetMoment(ctx context.Context, postIDStr, viewerPTID string) (*model.Post, error) {
	post, _, err := s.GetMomentDetail(ctx, postIDStr, viewerPTID)
	return post, err
}

// GetMomentDetail returns the owner-authored point-read outcome. Hidden,
// deleted, and absent rows never carry a Post payload.
func (s *MomentService) GetMomentDetail(
	ctx context.Context,
	postIDStr string,
	viewerPTID string,
) (*model.Post, model.PostDetailOutcome, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE,
			fmt.Errorf("invalid post_id %q", postIDStr)
	}

	batch, err := NewPublicReadPort(s.repos).Read(ctx, viewerPTID, []uint64{postID}, nil)
	if err != nil {
		return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, err
	}
	if p := batch.Posts[postID]; p != nil {
		post, err := s.hydratePostWith(ctx, p, viewerPTID, batch.Authors)
		if err != nil {
			return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, err
		}
		if post == nil {
			return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, nil
		}
		return post, model.PostDetailOutcome_POST_DETAIL_OUTCOME_AVAILABLE, nil
	}

	outcome, err := s.classifyUnreadableMoment(ctx, postID)
	return nil, outcome, err
}

func (s *MomentService) classifyUnreadableMoment(
	ctx context.Context,
	postID uint64,
) (model.PostDetailOutcome, error) {
	publicState, err := s.repos.PublicPosts.ProbeRecordState(ctx, postID)
	if err != nil {
		return model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, err
	}
	if publicState == domain.PostRecordDeleted {
		return model.PostDetailOutcome_POST_DETAIL_OUTCOME_DELETED, nil
	}
	if publicState == domain.PostRecordLive {
		return model.PostDetailOutcome_POST_DETAIL_OUTCOME_HIDDEN, nil
	}
	return model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, nil
}

// ListByAuthor serves a profile page. Only public posts are returned
// after the W11 hard-cut; legacy private posts are unreachable, and
// new private content is accessed through the Secure Content pipeline.
func (s *MomentService) ListByAuthor(ctx context.Context, authorPTID, viewerPTID, cursor string, limit int) ([]*model.Post, string, bool, error) {
	posts, nextCursor, hasMore, _, err := s.ListByAuthorPage(
		ctx,
		authorPTID,
		viewerPTID,
		cursor,
		limit,
	)
	return posts, nextCursor, hasMore, err
}

// ListByAuthorPage also reports the bounded candidate count so timeline
// callers can distinguish a true empty page from one filtered by policy.
func (s *MomentService) ListByAuthorPage(
	ctx context.Context,
	authorPTID string,
	viewerPTID string,
	cursor string,
	limit int,
) ([]*model.Post, string, bool, int, error) {
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, "", false, 0, fmt.Errorf("invalid cursor: %w", err)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	pubPosts, err := s.repos.PublicPosts.ListByAuthor(ctx, authorPTID, c, limit+1)
	if err != nil {
		return nil, "", false, 0, err
	}
	hasMore := len(pubPosts) > limit
	if hasMore {
		pubPosts = pubPosts[:limit]
	}
	scannedCount := len(pubPosts)

	batch, err := NewPublicReadPort(s.repos).authorize(ctx, viewerPTID, pubPosts, nil)
	if err != nil {
		return nil, "", false, scannedCount, err
	}
	readable := make([]*domain.Post, 0, len(pubPosts))
	for _, p := range pubPosts {
		if batch.Posts[p.ID] != nil {
			readable = append(readable, p)
		}
	}
	out := s.hydratePosts(ctx, readable, viewerPTID)

	var nextCursor string
	if hasMore && len(pubPosts) > 0 {
		last := pubPosts[len(pubPosts)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return out, nextCursor, hasMore, scannedCount, nil
}

func postAuthorPTIDs(posts []*domain.Post) []string {
	if len(posts) == 0 {
		return nil
	}
	authorPTIDs := make([]string, 0, len(posts))
	for _, p := range posts {
		if p != nil {
			authorPTIDs = append(authorPTIDs, p.AuthorPTID)
		}
	}
	return authorPTIDs
}

// hydratePosts is the batch sibling of `hydratePost` — use it whenever
// a list of posts will be returned to the wire (timeline, profile,
// list-by-author). It collapses what would otherwise be N+1 author
// lookups into one IN-clause query, matching the same pattern we use
// in `comment_service.go::ListByPost`.
//
// Reactions and viewer-interaction are still computed per-post for now
// — `ReactionService.Aggregate` already uses denormalised
// `reactions_count_json` columns so it's a single index hit per post,
// not a join. Folding it into the batch path is a P3 optimisation.
//
// Posts whose body decoding fails are logged and STILL returned with
// partial content; we never drop a post from a list silently.
func (s *MomentService) hydratePosts(ctx context.Context, posts []*domain.Post, viewerPTID string) []*model.Post {
	if len(posts) == 0 {
		return nil
	}

	authorPTIDs := make([]string, 0, len(posts))
	for _, p := range posts {
		if p != nil {
			authorPTIDs = append(authorPTIDs, p.AuthorPTID)
		}
	}
	authors, err := actor.GetActorsByPTIDs(ctx, authorPTIDs)
	if err != nil {
		// A failure here does not block rendering — we just lose the
		// `Author` decoration for this page. Log and continue.
		logger.Warn(ctx, "hydrate_posts: batch author lookup failed", "error", err)
		authors = make(map[string]*db.Actor, 0)
	}

	out := make([]*model.Post, 0, len(posts))
	for _, p := range posts {
		if p == nil {
			continue
		}
		hp, hErr := s.hydratePostWith(ctx, p, viewerPTID, authors)
		if hErr != nil {
			logger.Warn(ctx, "hydrate_posts: partial hydration", "error", hErr)
		}
		if hp != nil {
			out = append(out, hp)
		}
	}
	return out
}

// hydratePostWith is a low-level variant of `hydratePost` that takes a
// pre-fetched author map (from `hydratePosts`) instead of doing a
// per-call DB lookup. The single-post `hydratePost` path delegates to
// this with a nil map → falls back to per-call lookup.
func (s *MomentService) hydratePostWith(ctx context.Context, p *domain.Post, viewerPTID string, authors map[string]*db.Actor) (*model.Post, error) {
	out, convErr := s.conv.DomainToProto(p)
	if out == nil {
		return nil, convErr
	}

	var a *db.Actor
	if authors != nil {
		a = authors[p.AuthorPTID]
	}
	if a == nil {
		// Either single-post path or batch missed (concurrent delete,
		// FK violation in dev DB, ...). Fall back to a per-call hit.
		if got, err := actor.GetActorByPTID(ctx, p.AuthorPTID); err == nil {
			a = got
		}
	}
	if a != nil {
		out.Author = &model.PostAuthor{
			Id:                a.PTID,
			Username:          a.PreferredUsername,
			DisplayName:       a.Name,
			AvatarUrl:         a.Icon,
			FederatedHandle:   federatedHandleOf(a),
			HomeStationDomain: homeStationDomainOf(a),
		}
	}

	if s.reactions != nil {
		summaries, err := s.reactions.Aggregate(
			ctx,
			strconv.FormatUint(p.ID, 10),
			p.AuthorPTID,
			viewerPTID,
		)
		if err == nil && len(summaries) > 0 {
			out.Reactions = s.conv.SummariesToProto(summaries)
		}
	}

	if viewerPTID != "" {
		out.Interaction = &model.PostInteraction{}
		for _, r := range out.Reactions {
			if r.Kind == model.ReactionKind_REACTION_LIKE && r.ReactedByViewer {
				out.Interaction.IsLiked = true
				break
			}
		}
	}

	if out.CreatedAt == nil {
		out.CreatedAt = timestamppb.New(p.CreatedAt)
	}
	if out.UpdatedAt == nil {
		out.UpdatedAt = timestamppb.New(p.UpdatedAt)
	}
	return out, convErr
}

// hydratePost fills in the wire-shape `model.Post`'s author, reactions,
// and viewer-interaction fields. Returns the converted post even if a
// sub-step errors so clients render partial; the error is propagated
// for logging.
//
// For single-post read paths (GetMoment / CreateMoment response).
// List paths MUST use `hydratePosts` to avoid N+1 author lookups.
func (s *MomentService) hydratePost(ctx context.Context, p *domain.Post, viewerPTID string) (*model.Post, error) {
	return s.hydratePostWith(ctx, p, viewerPTID, nil)
}

func postNewer(a, b *domain.Post) bool {
	if a.CreatedAt.After(b.CreatedAt) {
		return true
	}
	if a.CreatedAt.Equal(b.CreatedAt) {
		return a.ID > b.ID
	}
	return false
}
