package application

import (
	"context"
	"errors"
	"fmt"

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
//   - Routing posts to the public/private repo pair based on
//     `IsPublic` (the storage-separation invariant's second defense
//     line — the repos themselves panic on the third).
//   - Composing the multi-write transactions for CUSTOM_* posts
//     (post insert + grants insert + dispatcher events).
//   - Validating cross-subserver assertions: CIRCLE ownership,
//     GROUP membership, mention PTID resolution.
//
// Stat hydration (author info, reactions snapshot, viewer interaction)
// happens here too — converters return Posts with empty `Author /
// Reactions / Interaction` and the application service fills those
// in via batch lookups so the converter stays storage-agnostic.
// maxImagesPerPost caps the number of image CIDs a single Moment can
// carry. Mirrors the desktop composer's 3x3 grid limit (D4 in
// `.dev-workflow/20260429-094000/plan.md`). Enforced server-side so a
// hand-rolled client cannot bypass the UI cap.
const maxImagesPerPost = 9

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

// CreateMoment persists a new Moment per the Audience selector on the
// request. The flow is:
//
//  1. Validate the audience shape + author-bound checks.
//  2. Resolve cross-subserver invariants:
//     - CIRCLE: confirm the author owns the target circle.
//     - GROUP: confirm the author is a member of the target group.
//     - CUSTOM_*: resolve actor PTIDs and verify the author isn't
//     self-included (already covered by ValidateForAuthor — kept
//     here as a defense-in-depth assertion).
//  3. Convert to a domain.Post.
//  4. Open a transaction and:
//     a. Insert the post via the appropriate repo (panics on misroute).
//     b. For CUSTOM_*, insert the audience-grant rows in the same TX.
//  5. Hydrate the wire-shape Post (Author + Audience + body + empty
//     stats) and return.
//  6. Emit a `MomentCreated` event (logged at INFO in P1; consumed by
//     the notification.Bridge in P3).
func (s *MomentService) CreateMoment(ctx context.Context, req *model.CreatePostRequest, authorPTID string) (*model.Post, error) {
	if req == nil {
		return nil, fmt.Errorf("CreatePostRequest is nil")
	}
	if authorPTID == "" {
		return nil, fmt.Errorf("authorPTID is required")
	}
	if req.Audience == nil {
		return nil, fmt.Errorf("CreatePostRequest.audience is required for the moments route")
	}

	if err := domain.ValidateForAuthor(authorPTID, req.Audience); err != nil {
		// In P1 the noop resolver returns an empty PTID for everyone,
		// so the CUSTOM_* author-self-inclusion check inside
		// ValidateForAuthor would fail with "requires non-empty author
		// PTID". Guard against that specific failure mode by skipping
		// the strict check when the resolver is no-op AND the audience
		// is CUSTOM_*. This is logged at WARN so the limitation is
		// audible.
		if authorPTID == "" && (req.Audience.Kind == model.Audience_CUSTOM_ALLOW || req.Audience.Kind == model.Audience_CUSTOM_DENY) {
			logger.Warn(ctx, "moment.create: CUSTOM_* author-PTID check skipped - actor resolver is no-op (P3 wiring pending)",
				"audience_kind", req.Audience.Kind.String(), "author_ptid", authorPTID)
		} else {
			return nil, fmt.Errorf("audience validation: %w", err)
		}
	}

	if err := s.assertAudienceTargetReachable(ctx, authorPTID, req.Audience); err != nil {
		return nil, err
	}

	if err := s.validateAttachmentCIDs(ctx, req); err != nil {
		return nil, err
	}

	// Repost gate: the caller must be able to READ the original post
	// before they're allowed to wrap it in a public REPOST envelope.
	// Without this check, anyone holding a private post id could turn
	// "I know this id exists in author X's private inventory" into a
	// publicly attributable wrapper post. We only validate readability
	// here; whether the original is itself reposted is a P3 concern
	// (we'd need to walk the chain).
	if req.Type == model.PostType_REPOST {
		original := req.GetRepost().GetOriginalPostId()
		if original == "" {
			return nil, fmt.Errorf("repost requires original_post_id")
		}
		readable, gerr := s.GetMoment(ctx, original, authorPTID)
		if gerr != nil {
			return nil, fmt.Errorf("repost gate: %w", gerr)
		}
		if readable == nil {
			return nil, fmt.Errorf("repost source post %s is not readable", original)
		}
	}

	mentions := req.Audience.GetActorPtids()
	_ = mentions // mentions extraction is deferred to P3; preserved field for future use.

	domainPost, err := s.conv.CreateRequestToDomain(req, authorPTID, nil /* mentions */)
	if err != nil {
		return nil, fmt.Errorf("convert request: %w", err)
	}

	if err := s.persistInTx(ctx, domainPost); err != nil {
		return nil, err
	}

	out, err := s.hydratePost(ctx, domainPost, authorPTID)
	if err != nil {
		// Hydration errors are non-fatal — return the post with
		// whatever fields succeeded; clients render partial.
		logger.Warn(ctx, "moment.create: hydration partial", "post_id", domainPost.ID, "error", err)
	}

	logger.Info(ctx, "moment.created",
		"post_id", domainPost.ID,
		"author_ptid", authorPTID,
		"audience_kind", req.Audience.Kind.String(),
		"is_public", domainPost.IsPublic())
	if s.publisher != nil {
		s.publisher.PublishCreated(ctx, domainPost.ID, authorPTID, req.Audience)
	}
	return out, nil
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
	switch req.Type {
	case model.PostType_IMAGE:
		img := req.GetImage()
		if img == nil {
			return fmt.Errorf("IMAGE post requires CreateImagePostRequest content")
		}
		imageIDs, err := imageIDsFromCreateRequest(img)
		if err != nil {
			return err
		}
		if n := len(imageIDs); n == 0 {
			return fmt.Errorf("IMAGE post requires at least one image_id")
		} else if n > maxImagesPerPost {
			return fmt.Errorf("IMAGE post supports at most %d images, got %d", maxImagesPerPost, n)
		}
		return s.media.ValidateCIDs(ctx, imageIDs)

	case model.PostType_VIDEO:
		// Video is deferred to a later iteration (see plan D3) but the
		// gate is wired now so a stray client request can't smuggle
		// arbitrary CIDs in via the video path.
		vid := req.GetVideo()
		if vid == nil || vid.VideoId == "" {
			return nil
		}
		return s.media.ValidateCIDs(ctx, []string{vid.VideoId})

	case model.PostType_LOCATION:
		loc := req.GetLocation()
		if loc == nil || len(loc.ImageIds) == 0 {
			return nil
		}
		if n := len(loc.ImageIds); n > maxImagesPerPost {
			return fmt.Errorf("LOCATION post supports at most %d images, got %d", maxImagesPerPost, n)
		}
		return s.media.ValidateCIDs(ctx, loc.ImageIds)
	}
	return nil
}

func imageIDsFromCreateRequest(img *model.CreateImagePostRequest) ([]string, error) {
	if img == nil {
		return nil, nil
	}
	if len(img.ImageIds) > 0 && len(img.Images) > 0 {
		return nil, fmt.Errorf("IMAGE post accepts either image_ids or images, not both")
	}
	if len(img.ImageIds) > 0 {
		return img.ImageIds, nil
	}
	ids := make([]string, 0, len(img.Images))
	for _, image := range img.Images {
		if image == nil {
			continue
		}
		if image.Id != "" {
			ids = append(ids, image.Id)
		} else if image.Url != "" {
			ids = append(ids, image.Url)
		}
	}
	return ids, nil
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
		c, err := s.repos.Circles.GetByID(ctx, a.TargetId)
		if err != nil {
			return fmt.Errorf("lookup circle %d: %w", a.TargetId, err)
		}
		if c == nil || c.OwnerPTID != authorPTID {
			return fmt.Errorf("circle %d does not exist or is not owned by author", a.TargetId)
		}

	case model.Audience_GROUP:
		isMember, err := s.groups.IsMember(ctx, a.TargetId, authorPTID)
		if err != nil {
			return fmt.Errorf("lookup group membership: %w", err)
		}
		if !isMember {
			return fmt.Errorf("author is not a member of group %d (or chat subserver not wired in P1)", a.TargetId)
		}
	}
	return nil
}

// persistInTx writes the post inside a single transaction.
func (s *MomentService) persistInTx(ctx context.Context, p *domain.Post) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Construct a per-transaction Repos snapshot so the inner
		// repo calls participate in the same TX rather than the
		// shared *gorm.DB.
		txRepos := infrastructure.NewRepos(tx)

		if p.IsPublic() {
			if err := txRepos.PublicPosts.Create(ctx, p); err != nil {
				return fmt.Errorf("public post create: %w", err)
			}
		} else {
			// W11 hard-cut: legacy private posts are no longer created
			// through this path. New private content uses the Secure
			// Content prepare/submit pipeline.
			return fmt.Errorf("legacy private post creation removed; use prepare-private/submit-private routes")
		}

		deliveries, err := s.buildMomentDeliveries(ctx, txRepos, p)
		if err != nil {
			return fmt.Errorf("build moment deliveries: %w", err)
		}
		if err := txRepos.Deliveries.Upsert(ctx, deliveries); err != nil {
			return fmt.Errorf("moment deliveries: %w", err)
		}
		return nil
	})
}

func (s *MomentService) buildMomentDeliveries(ctx context.Context, repos *infrastructure.Repos, p *domain.Post) ([]domain.MomentDelivery, error) {
	if p == nil || p.IsPublic() || p.Audience == nil {
		return nil, nil
	}

	recipients := map[string]struct{}{p.AuthorPTID: {}}
	switch p.Audience.Kind {
	case model.Audience_SELF:
		// Author-only delivery is already seeded above.

	case model.Audience_FOLLOWERS:
		followers, err := repos.Follows.FollowerActorPTIDs(ctx, p.AuthorPTID)
		if err != nil {
			return nil, err
		}
		for _, ptid := range followers {
			recipients[ptid] = struct{}{}
		}

	case model.Audience_CUSTOM_ALLOW:
		for _, ptid := range p.Audience.ActorPtids {
			if ptid != "" {
				recipients[ptid] = struct{}{}
			}
		}

	case model.Audience_CUSTOM_DENY:
		if p.Audience.BaseKind != model.Audience_FOLLOWERS {
			break
		}
		followers, err := repos.Follows.FollowerActorPTIDs(ctx, p.AuthorPTID)
		if err != nil {
			return nil, err
		}
		denied := make(map[string]struct{})
		for _, ptid := range p.Audience.ActorPtids {
			if ptid != "" {
				denied[ptid] = struct{}{}
			}
		}
		for _, ptid := range followers {
			if _, blocked := denied[ptid]; !blocked {
				recipients[ptid] = struct{}{}
			}
		}

	case model.Audience_CIRCLE, model.Audience_GROUP:
		// Real CIRCLE/GROUP fan-out waits for the ActorResolver and
		// GroupMembershipChecker contracts to expose durable local IDs.
		// Until then, author delivery preserves self-device consistency.
	}

	deliveries := make([]domain.MomentDelivery, 0, len(recipients))
	for viewerPTID := range recipients {
		if viewerPTID == "" {
			continue
		}
		deliveries = append(deliveries, domain.MomentDelivery{
			ViewerPTID:   viewerPTID,
			PostID:       p.ID,
			AuthorPTID:   p.AuthorPTID,
			AudienceKind: p.Audience.Kind.String(),
			DeliveredAt:  p.CreatedAt,
		})
	}
	return deliveries, nil
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
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE,
			fmt.Errorf("invalid post_id %q", postIDStr)
	}

	if p, err := s.repos.PublicPosts.GetByID(ctx, postID); err != nil {
		return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, err
	} else if p != nil {
		viewer, err := buildViewerForAuthors(ctx, viewerPTID, s.repos, s.groups, []string{p.AuthorPTID})
		if err != nil {
			return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE,
				fmt.Errorf("build viewer: %w", err)
		}
		if ok, _ := domain.CanRead(viewer, p.AuthorPTID, p.Audience, p.IsDeleted()); !ok {
			return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_HIDDEN, nil
		}
		if blocked, err := actorStationModerated(ctx, s.repos.Moderation, p.AuthorPTID); err != nil {
			return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE, err
		} else if blocked {
			return nil, model.PostDetailOutcome_POST_DETAIL_OUTCOME_HIDDEN, nil
		}
		post, err := s.hydratePost(ctx, p, viewerPTID)
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

// DeleteMoment soft-deletes a public post. Legacy private posts are
// unreachable after W11; new private content deletion goes through the
// Secure Content pipeline. Returns nil when the post doesn't exist or
// the caller is not the author, so the handler doesn't leak existence.
func (s *MomentService) DeleteMoment(ctx context.Context, postIDStr, authorPTID string) error {
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return fmt.Errorf("invalid post_id %q", postIDStr)
	}
	owned, err := s.repos.PublicPosts.GetByID(ctx, postID)
	if err != nil {
		return err
	}
	if owned == nil || owned.AuthorPTID != authorPTID {
		return nil
	}
	if err := s.repos.PublicPosts.Delete(ctx, postID, authorPTID); err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	}
	if s.repos.Deliveries != nil {
		if err := s.repos.Deliveries.RevokePost(ctx, postID); err != nil {
			logger.Warn(ctx, "moment.delete: delivery revoke failed", "post_id", postID, "error", err)
		}
	}
	logger.Info(ctx, "moment.deleted", "post_id", postID, "author_ptid", authorPTID)
	if s.publisher != nil {
		s.publisher.PublishDeleted(ctx, postID, authorPTID)
	}
	return nil
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
	moderated, err := actorStationModerated(ctx, s.repos.Moderation, authorPTID)
	if err != nil {
		return nil, "", false, 0, err
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

	viewer, err := buildViewerForAuthors(ctx, viewerPTID, s.repos, s.groups, postAuthorPTIDs(pubPosts))
	if err != nil {
		return nil, "", false, scannedCount, fmt.Errorf("build viewer: %w", err)
	}
	readable := make([]*domain.Post, 0, len(pubPosts))
	if !moderated {
		for _, p := range pubPosts {
			if ok, _ := domain.CanRead(viewer, p.AuthorPTID, p.Audience, p.IsDeleted()); !ok {
				continue
			}
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
			logger.Warn(ctx, "hydrate_posts: partial hydration", "post_id", p.ID, "error", hErr)
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
		summaries, err := s.reactions.Aggregate(ctx, p.ID, p.AuthorPTID, viewerPTID)
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
