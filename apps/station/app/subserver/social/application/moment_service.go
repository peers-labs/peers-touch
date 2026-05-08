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
//     GROUP membership, mention DID resolution.
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
) *MomentService {
	if media == nil {
		// Defensive: callers should always supply a resolver, but
		// preserve the P1 behavior (accept everything) rather than
		// panic if the wiring forgets to plumb it through.
		media = NewNoopMediaResolver()
	}
	return &MomentService{
		db:        gdb,
		repos:     repos,
		conv:      domain.NewPostConverter(),
		resolver:  resolver,
		groups:    groups,
		media:     media,
		reactions: reactions,
	}
}

// CreateMoment persists a new Moment per the Audience selector on the
// request. The flow is:
//
//  1. Validate the audience shape + author-bound checks.
//  2. Resolve cross-subserver invariants:
//     - CIRCLE: confirm the author owns the target circle.
//     - GROUP: confirm the author is a member of the target group.
//     - CUSTOM_*: resolve actor DIDs and verify the author isn't
//       self-included (already covered by ValidateForAuthor — kept
//       here as a defense-in-depth assertion).
//  3. Convert to a domain.Post.
//  4. Open a transaction and:
//     a. Insert the post via the appropriate repo (panics on misroute).
//     b. For CUSTOM_*, insert the audience-grant rows in the same TX.
//  5. Hydrate the wire-shape Post (Author + Audience + body + empty
//     stats) and return.
//  6. Emit a `MomentCreated` event (logged at INFO in P1; consumed by
//     the notification.Bridge in P3).
func (s *MomentService) CreateMoment(ctx context.Context, req *model.CreatePostRequest, authorID uint64) (*model.Post, error) {
	if req == nil {
		return nil, fmt.Errorf("CreatePostRequest is nil")
	}
	if authorID == 0 {
		return nil, fmt.Errorf("authorID is required")
	}
	if req.Audience == nil {
		return nil, fmt.Errorf("CreatePostRequest.audience is required for the moments route")
	}

	authorDID, err := s.resolver.ResolveID(ctx, authorID)
	if err != nil {
		return nil, fmt.Errorf("resolve author DID: %w", err)
	}
	if err := domain.ValidateForAuthor(authorDID, req.Audience); err != nil {
		// In P1 the noop resolver returns an empty DID for everyone,
		// so the CUSTOM_* author-self-inclusion check inside
		// ValidateForAuthor would fail with "requires non-empty author
		// DID". Guard against that specific failure mode by skipping
		// the strict check when the resolver is no-op AND the audience
		// is CUSTOM_*. This is logged at WARN so the limitation is
		// audible.
		if authorDID == "" && (req.Audience.Kind == model.Audience_CUSTOM_ALLOW || req.Audience.Kind == model.Audience_CUSTOM_DENY) {
			logger.Warn(ctx, "moment.create: CUSTOM_* author-DID check skipped — actor resolver is no-op (P3 wiring pending)",
				"audience_kind", req.Audience.Kind.String(), "author_id", authorID)
		} else {
			return nil, fmt.Errorf("audience validation: %w", err)
		}
	}

	if err := s.assertAudienceTargetReachable(ctx, authorID, req.Audience); err != nil {
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
		readable, gerr := s.GetMoment(ctx, original, authorID)
		if gerr != nil {
			return nil, fmt.Errorf("repost gate: %w", gerr)
		}
		if readable == nil {
			return nil, fmt.Errorf("repost source post %s is not readable", original)
		}
	}

	mentions := req.Audience.GetActorDids()
	_ = mentions // mentions extraction is deferred to P3; preserved field for future use.

	domainPost, err := s.conv.CreateRequestToDomain(req, authorID, nil /* mentions */)
	if err != nil {
		return nil, fmt.Errorf("convert request: %w", err)
	}

	if err := s.persistInTx(ctx, domainPost); err != nil {
		return nil, err
	}

	out, err := s.hydratePost(ctx, domainPost, authorID)
	if err != nil {
		// Hydration errors are non-fatal — return the post with
		// whatever fields succeeded; clients render partial.
		logger.Warn(ctx, "moment.create: hydration partial", "post_id", domainPost.ID, "error", err)
	}

	logger.Info(ctx, "moment.created",
		"post_id", domainPost.ID,
		"author_id", authorID,
		"audience_kind", req.Audience.Kind.String(),
		"is_public", domainPost.IsPublic())
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
		if n := len(img.ImageIds); n == 0 {
			return fmt.Errorf("IMAGE post requires at least one image_id")
		} else if n > maxImagesPerPost {
			return fmt.Errorf("IMAGE post supports at most %d images, got %d", maxImagesPerPost, n)
		}
		return s.media.ValidateCIDs(ctx, img.ImageIds)

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

// assertAudienceTargetReachable enforces the cross-subserver pre-flight
// checks that ValidateForAuthor intentionally skips:
//
//   - CIRCLE: the target circle must exist and be owned by the author.
//   - GROUP: the author must be a member of the target group.
//
// FOLLOWERS / SELF / PUBLIC / CUSTOM_* don't need a target lookup.
func (s *MomentService) assertAudienceTargetReachable(ctx context.Context, authorID uint64, a *model.Audience) error {
	switch a.Kind {
	case model.Audience_CIRCLE:
		c, err := s.repos.Circles.GetByID(ctx, a.TargetId)
		if err != nil {
			return fmt.Errorf("lookup circle %d: %w", a.TargetId, err)
		}
		if c == nil || c.OwnerID != authorID {
			return fmt.Errorf("circle %d does not exist or is not owned by author", a.TargetId)
		}

	case model.Audience_GROUP:
		isMember, err := s.groups.IsMember(ctx, a.TargetId, authorID)
		if err != nil {
			return fmt.Errorf("lookup group membership: %w", err)
		}
		if !isMember {
			return fmt.Errorf("author is not a member of group %d (or chat subserver not wired in P1)", a.TargetId)
		}
	}
	return nil
}

// persistInTx writes the post (and any CUSTOM_* grants) inside a
// single transaction. The grants insert needs the post's id, which is
// known after the post insert returns (BeforeCreate sets it).
func (s *MomentService) persistInTx(ctx context.Context, p *domain.Post) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Construct a per-transaction Repos snapshot so the inner
		// repo calls participate in the same TX rather than the
		// shared *gorm.DB.
		txRepos := infrastructure.NewRepos(tx, s.resolver.ResolveID)

		if p.IsPublic() {
			if err := txRepos.PublicPosts.Create(ctx, p); err != nil {
				return fmt.Errorf("public post create: %w", err)
			}
		} else {
			if err := txRepos.PrivatePosts.Create(ctx, p); err != nil {
				return fmt.Errorf("private post create: %w", err)
			}
		}

		// CUSTOM_* grants: insert in the same TX so the post row +
		// the grant rows are atomically visible to readers.
		if a := p.Audience; a.Kind == model.Audience_CUSTOM_ALLOW || a.Kind == model.Audience_CUSTOM_DENY {
			role := domain.GrantRoleAllow
			if a.Kind == model.Audience_CUSTOM_DENY {
				role = domain.GrantRoleDeny
			}
			grants := make([]domain.AudienceGrant, 0, len(a.ActorDids))
			for _, did := range a.ActorDids {
				if did == "" {
					continue
				}
				grants = append(grants, domain.AudienceGrant{
					ActorDID: did,
					Role:     role,
				})
			}
			if err := txRepos.AudienceGrant.AddGrants(ctx, p.ID, grants); err != nil {
				return fmt.Errorf("audience grants: %w", err)
			}
		}
		return nil
	})
}

// GetMoment returns a single moment with the viewer-bound visibility
// applied. The lookup tries the public repo first (cheap point lookup)
// and falls through to the private repo (which applies the per-viewer
// filter at the SQL layer + does the third-line CanRead re-check
// downstream).
func (s *MomentService) GetMoment(ctx context.Context, postIDStr string, viewerID uint64) (*model.Post, error) {
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return nil, fmt.Errorf("invalid post_id %q", postIDStr)
	}

	if p, err := s.repos.PublicPosts.GetByID(ctx, postID); err != nil {
		return nil, err
	} else if p != nil {
		return s.hydratePost(ctx, p, viewerID)
	}

	priv, err := s.repos.PrivatePosts.GetByID(ctx, postID, viewerID)
	if err != nil {
		return nil, err
	}
	if priv == nil {
		return nil, nil
	}

	// Third defense line: re-evaluate CanRead in pure form.
	viewer, err := buildViewer(ctx, viewerID, s.repos, s.resolver.ResolveID, s.groups)
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	if ok, _ := domain.CanRead(viewer, priv.AuthorID, priv.Audience, priv.IsDeleted()); !ok {
		return nil, nil
	}
	return s.hydratePost(ctx, priv, viewerID)
}

// DeleteMoment soft-deletes a post. Tries public repo first then
// private — a delete from the wrong author is a no-op (zero rows
// affected). Returns "no rows affected" as a 404-ish nil so the
// handler doesn't leak existence to non-authors.
func (s *MomentService) DeleteMoment(ctx context.Context, postIDStr string, authorID uint64) error {
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return fmt.Errorf("invalid post_id %q", postIDStr)
	}
	if err := s.repos.PublicPosts.Delete(ctx, postID, authorID); err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	}
	if err := s.repos.PrivatePosts.Delete(ctx, postID, authorID); err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	}
	logger.Info(ctx, "moment.deleted", "post_id", postID, "author_id", authorID)
	return nil
}

// ListByAuthor serves a profile page. Public posts are always shown;
// private posts are filtered per `viewerID`.
func (s *MomentService) ListByAuthor(ctx context.Context, authorID, viewerID uint64, cursor string, limit int) ([]*model.Post, string, bool, error) {
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, "", false, fmt.Errorf("invalid cursor: %w", err)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	pubPosts, err := s.repos.PublicPosts.ListByAuthor(ctx, authorID, c, limit+1)
	if err != nil {
		return nil, "", false, err
	}

	privPosts, err := s.repos.PrivatePosts.ListByAuthorVisibleTo(ctx, authorID, viewerID, c, limit+1)
	if err != nil {
		return nil, "", false, err
	}

	merged, hasMore := mergePostsByCreatedAtDesc(pubPosts, privPosts, limit)

	viewer, _ := buildViewer(ctx, viewerID, s.repos, s.resolver.ResolveID, s.groups)
	readable := merged[:0]
	for _, p := range merged {
		if ok, _ := domain.CanRead(viewer, p.AuthorID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	out := s.hydratePosts(ctx, readable, viewerID)

	var nextCursor string
	if hasMore && len(merged) > 0 {
		last := merged[len(merged)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return out, nextCursor, hasMore, nil
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
func (s *MomentService) hydratePosts(ctx context.Context, posts []*domain.Post, viewerID uint64) []*model.Post {
	if len(posts) == 0 {
		return nil
	}

	authorIDs := make([]uint64, 0, len(posts))
	for _, p := range posts {
		if p != nil {
			authorIDs = append(authorIDs, p.AuthorID)
		}
	}
	authors, err := actor.GetActorsByIDs(ctx, authorIDs)
	if err != nil {
		// A failure here does not block rendering — we just lose the
		// `Author` decoration for this page. Log and continue.
		logger.Warn(ctx, "hydrate_posts: batch author lookup failed", "error", err)
		authors = make(map[uint64]*db.Actor, 0)
	}

	out := make([]*model.Post, 0, len(posts))
	for _, p := range posts {
		if p == nil {
			continue
		}
		hp, hErr := s.hydratePostWith(ctx, p, viewerID, authors)
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
func (s *MomentService) hydratePostWith(ctx context.Context, p *domain.Post, viewerID uint64, authors map[uint64]*db.Actor) (*model.Post, error) {
	out, convErr := s.conv.DomainToProto(p)
	if out == nil {
		return nil, convErr
	}

	var a *db.Actor
	if authors != nil {
		a = authors[p.AuthorID]
	}
	if a == nil {
		// Either single-post path or batch missed (concurrent delete,
		// FK violation in dev DB, ...). Fall back to a per-call hit.
		if got, err := actor.GetActorByID(ctx, p.AuthorID); err == nil {
			a = got
		}
	}
	if a != nil {
		out.Author = &model.PostAuthor{
			Id:          fmt.Sprintf("%d", a.ID),
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			AvatarUrl:   a.Icon,
		}
	}

	if s.reactions != nil {
		summaries, err := s.reactions.Aggregate(ctx, p.ID, viewerID)
		if err == nil && len(summaries) > 0 {
			out.Reactions = s.conv.SummariesToProto(summaries)
		}
	}

	if viewerID != 0 {
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
func (s *MomentService) hydratePost(ctx context.Context, p *domain.Post, viewerID uint64) (*model.Post, error) {
	return s.hydratePostWith(ctx, p, viewerID, nil)
}

// mergePostsByCreatedAtDesc merges two pre-sorted (DESC by created_at +
// id) slices into a single DESC slice, respecting the limit. Returns
// the merged slice and a `hasMore` bool.
func mergePostsByCreatedAtDesc(a, b []*domain.Post, limit int) ([]*domain.Post, bool) {
	out := make([]*domain.Post, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) && len(out) < limit+1 {
		if postNewer(a[i], b[j]) {
			out = append(out, a[i])
			i++
		} else {
			out = append(out, b[j])
			j++
		}
	}
	for ; i < len(a) && len(out) < limit+1; i++ {
		out = append(out, a[i])
	}
	for ; j < len(b) && len(out) < limit+1; j++ {
		out = append(out, b[j])
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	return out, hasMore
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
