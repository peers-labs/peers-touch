package application

import (
	"context"
	"fmt"
	"strconv"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// TimelineService composes the multi-source HOME timeline plus the
// simpler USER and PUBLIC variants. The HOME merge interleaves five
// independent sources by `created_at DESC`:
//
//  1. self-public (the viewer's own public posts)
//  2. self-private (the viewer's own private posts; SELF + FOLLOWERS
//     + CIRCLE + GROUP + CUSTOM_*)
//  3. followed-public (public posts authored by people the viewer
//     follows)
//  4. followed-followers-private (FOLLOWERS-audience posts authored
//     by people the viewer follows)
//  5. circle-private (CIRCLE posts targeting circles the viewer is in)
//  6. group-private (GROUP posts targeting groups the viewer is in)
//
// Each source uses its own cursor (encapsulated in
// `domain.MultiSourceCursor`); a source whose page is exhausted is
// marked nil and skipped on subsequent pages.
//
// CanRead is invoked per row as a third defense line — the SQL filters
// in the repos are belt-and-braces, this is the suspenders.
type TimelineService struct {
	repos    *infrastructure.Repos
	moments  *MomentService
	resolver domain.ActorResolver
	groups   domain.GroupMembershipChecker
}

func NewTimelineService(repos *infrastructure.Repos, moments *MomentService, resolver domain.ActorResolver, groups domain.GroupMembershipChecker) *TimelineService {
	return &TimelineService{repos: repos, moments: moments, resolver: resolver, groups: groups}
}

// GetTimeline dispatches per `req.Type`.
func (s *TimelineService) GetTimeline(ctx context.Context, req *model.GetTimelineRequest, viewerPTID string) (*model.GetTimelineResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	switch req.Type {
	case model.TimelineType_TIMELINE_PUBLIC:
		if req.Sort == model.TimelineSort_TIMELINE_SORT_HOT {
			return s.getPublicHotTimeline(ctx, req.Cursor, limit, viewerPTID)
		}
		return s.getPublicTimeline(ctx, req.Cursor, limit, viewerPTID)
	case model.TimelineType_TIMELINE_USER:
		if req.ActorPtid == "" {
			return nil, fmt.Errorf("invalid actor_ptid")
		}
		posts, nextCursor, hasMore, scannedCount, err := s.moments.ListByAuthorPage(
			ctx,
			req.ActorPtid,
			viewerPTID,
			req.Cursor,
			limit,
		)
		if err != nil {
			return nil, err
		}
		posts, err = s.applyStationModeration(ctx, posts)
		if err != nil {
			return nil, err
		}
		return finalizeTimelineResponse(&model.GetTimelineResponse{
			Posts:        posts,
			NextCursor:   nextCursor,
			HasMore:      hasMore,
			Explanations: buildFeedObjectExplanations(posts, nil, model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW),
		}, scannedCount), nil
	case model.TimelineType_TIMELINE_HOME:
		return s.getHomeTimeline(ctx, req.Cursor, limit, viewerPTID)
	default:
		return nil, fmt.Errorf("unsupported timeline type %s", req.Type)
	}
}

// getPublicTimeline returns the global public-only feed. Uses a
// single-source cursor — no merge necessary because only the public
// table is involved.
func (s *TimelineService) getPublicTimeline(ctx context.Context, cursor string, limit int, viewerPTID string) (*model.GetTimelineResponse, error) {
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	rows, err := s.repos.PublicPosts.ListPublic(ctx, c, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	scannedRows := append([]*domain.Post(nil), rows...)
	viewer, err := buildViewerForAuthors(ctx, viewerPTID, s.repos, s.groups, postAuthorPTIDs(rows))
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	readable := rows[:0]
	for _, p := range rows {
		if ok, _ := domain.CanRead(viewer, p.AuthorPTID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	rows = readable
	posts := s.moments.hydratePosts(ctx, rows, viewerPTID)
	posts, err = s.applyStationModeration(ctx, posts)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(scannedRows) > 0 {
		last := scannedRows[len(scannedRows)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return finalizeTimelineResponse(&model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextCursor,
		HasMore:      hasMore,
		Explanations: buildFeedObjectExplanations(posts, nil, model.RelationshipReason_RELATIONSHIP_REASON_PUBLIC_FEDERATED),
	}, len(scannedRows)), nil
}

// getPublicHotTimeline returns the trending public feed. Repo
// computes the score in SQL and orders by it; we only need to encode
// the next cursor from the last row of the page.
func (s *TimelineService) getPublicHotTimeline(ctx context.Context, cursor string, limit int, viewerPTID string) (*model.GetTimelineResponse, error) {
	c, err := domain.DecodeHotCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid hot cursor: %w", err)
	}
	rows, err := s.repos.PublicPosts.ListPublicHot(ctx, c, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	scannedRows := append([]*domain.Post(nil), rows...)
	viewer, err := buildViewerForAuthors(ctx, viewerPTID, s.repos, s.groups, postAuthorPTIDs(rows))
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	readable := rows[:0]
	for _, p := range rows {
		if ok, _ := domain.CanRead(viewer, p.AuthorPTID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	rows = readable
	posts := s.moments.hydratePosts(ctx, rows, viewerPTID)
	posts, err = s.applyStationModeration(ctx, posts)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(scannedRows) > 0 {
		last := scannedRows[len(scannedRows)-1]
		nextCursor = domain.HotCursor{
			Score:     float64(last.CommentsCount),
			CreatedAt: last.CreatedAt,
			LastID:    last.ID,
		}.Encode()
	}
	return finalizeTimelineResponse(&model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextCursor,
		HasMore:      hasMore,
		Explanations: buildFeedObjectExplanations(posts, nil, model.RelationshipReason_RELATIONSHIP_REASON_PUBLIC_FEDERATED),
	}, len(scannedRows)), nil
}

// getHomeTimeline merges the six sources described in the package
// header. Anonymous viewers (viewerID == 0) get an empty result —
// "home" is meaningless without an identity. Plan callers should
// dispatch them to the public timeline instead; we keep the empty
// behaviour here so a misrouted call doesn't 500.
func (s *TimelineService) getHomeTimeline(ctx context.Context, cursor string, limit int, viewerPTID string) (*model.GetTimelineResponse, error) {
	if s.repos.Deliveries == nil {
		return s.getLegacyHomeTimeline(ctx, cursor, limit, viewerPTID)
	}
	return s.getDeliveryHomeTimeline(ctx, cursor, limit, viewerPTID)
}

func (s *TimelineService) getDeliveryHomeTimeline(ctx context.Context, cursor string, limit int, viewerPTID string) (*model.GetTimelineResponse, error) {
	if viewerPTID == "" {
		return finalizeTimelineResponse(&model.GetTimelineResponse{}, 0), nil
	}

	mc, err := domain.DecodeMultiSourceCursor(cursor)
	if err != nil {
		single, sErr := domain.DecodeCursor(cursor)
		if sErr != nil {
			return nil, fmt.Errorf("invalid cursor: %w", err)
		}
		mc.SetSource("delivery", &single)
		mc.SetSource("self_public", &single)
		mc.SetSource("followed_public", &single)
	}

	viewer, err := buildViewer(ctx, viewerPTID, s.repos, s.groups)
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	followingPTIDs := make([]string, 0, len(viewer.Following))
	for ptid := range viewer.Following {
		followingPTIDs = append(followingPTIDs, ptid)
	}

	pageBudget := limit + 1
	deliveries, err := s.repos.Deliveries.ListInbox(ctx, viewerPTID, mc.Source("delivery"), pageBudget)
	if err != nil {
		return nil, err
	}
	selfPublic, err := s.repos.PublicPosts.ListByAuthor(
		ctx,
		viewerPTID,
		mc.Source("self_public"),
		pageBudget,
	)
	if err != nil {
		return nil, err
	}
	followedPublic, err := s.repos.PublicPosts.ListPublicByAuthors(
		ctx,
		followingPTIDs,
		mc.Source("followed_public"),
		pageBudget,
	)
	if err != nil {
		return nil, err
	}

	items := make([]timelineItem, 0, len(deliveries)+len(selfPublic)+len(followedPublic))
	for i := range deliveries {
		d := deliveries[i]
		post, err := s.moments.GetMoment(ctx, fmt.Sprintf("%d", d.PostID), viewerPTID)
		if err != nil {
			return nil, err
		}
		domainPost := &domain.Post{ID: d.PostID, AuthorPTID: d.AuthorPTID, CreatedAt: d.DeliveredAt}
		if post == nil {
			items = append(items, timelineItem{
				source:   "delivery",
				delivery: &d,
				post:     domainPost,
				filtered: true,
			})
			continue
		}
		items = append(items, timelineItem{source: "delivery", delivery: &d, post: domainPost, wire: post})
	}
	for _, p := range selfPublic {
		items = append(items, timelineItem{source: "self_public", post: p})
	}
	for _, p := range followedPublic {
		items = append(items, timelineItem{source: "followed_public", post: p})
	}

	sortTimelineItems(items)
	if len(items) > pageBudget {
		items = items[:pageBudget]
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	scannedCount := len(items)

	posts := make([]*model.Post, 0, len(items))
	reasonsByPostID := make(map[string]model.RelationshipReason_Kind, len(items))
	srcLastSeen := make(map[string]timelineItem)
	for _, item := range items {
		srcLastSeen[item.source] = item
		if item.filtered {
			continue
		}
		var wirePost *model.Post
		if item.wire != nil {
			wirePost = item.wire
		} else if item.post != nil {
			got := s.moments.hydratePosts(ctx, []*domain.Post{item.post}, viewerPTID)
			if len(got) > 0 {
				wirePost = got[0]
			}
		}
		if wirePost != nil {
			posts = append(posts, wirePost)
			reasonsByPostID[wirePost.GetId()] = timelineReasonFromSource(item.source, item.deliveryAudienceKind())
		}
	}
	posts, err = s.applyStationModeration(ctx, posts)
	if err != nil {
		return nil, err
	}

	if !hasMore {
		return finalizeTimelineResponse(&model.GetTimelineResponse{
			Posts:        posts,
			Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
		}, scannedCount), nil
	}
	nextMC := domain.MultiSourceCursor{}
	for _, name := range []string{"delivery", "self_public", "followed_public"} {
		item, ok := srcLastSeen[name]
		if !ok {
			continue
		}
		if name == "delivery" && item.delivery != nil {
			cur := domain.Cursor{LastID: item.delivery.ID, CreatedAt: item.delivery.DeliveredAt}
			nextMC.SetSource(name, &cur)
			continue
		}
		if item.post != nil {
			cur := domain.Cursor{LastID: item.post.ID, CreatedAt: item.post.CreatedAt}
			nextMC.SetSource(name, &cur)
		}
	}
	return finalizeTimelineResponse(&model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextMC.Encode(),
		HasMore:      true,
		Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
	}, scannedCount), nil
}

func (s *TimelineService) getLegacyHomeTimeline(ctx context.Context, cursor string, limit int, viewerPTID string) (*model.GetTimelineResponse, error) {
	if viewerPTID == "" {
		return finalizeTimelineResponse(&model.GetTimelineResponse{}, 0), nil
	}

	mc, err := domain.DecodeMultiSourceCursor(cursor)
	if err != nil {
		// Tolerate malformed multi-source cursor by trying the
		// single-source decode for backward compat with older
		// clients still on the legacy timeline shape.
		single, sErr := domain.DecodeCursor(cursor)
		if sErr != nil {
			return nil, fmt.Errorf("invalid cursor: %w", err)
		}
		mc.SetSource("self_public", &single)
		mc.SetSource("self_private", &single)
		mc.SetSource("followed_public", &single)
		mc.SetSource("followed_followers", &single)
		mc.SetSource("circles", &single)
		mc.SetSource("groups", &single)
	}

	viewer, err := buildViewer(ctx, viewerPTID, s.repos, s.groups)
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}

	followingPTIDs := make([]string, 0, len(viewer.Following))
	for ptid := range viewer.Following {
		followingPTIDs = append(followingPTIDs, ptid)
	}
	circleIDs := make([]uint64, 0, len(viewer.MemberOfCircles))
	for id := range viewer.MemberOfCircles {
		circleIDs = append(circleIDs, id)
	}
	groupIDs := make([]uint64, 0, len(viewer.MemberOfGroups))
	for id := range viewer.MemberOfGroups {
		groupIDs = append(groupIDs, id)
	}

	pageBudget := limit + 1

	srcSelfPublic, err := s.repos.PublicPosts.ListByAuthor(ctx, viewerPTID, mc.Source("self_public"), pageBudget)
	if err != nil {
		return nil, err
	}
	srcSelfPrivate, err := s.repos.PrivatePosts.ListByAuthorVisibleTo(ctx, viewerPTID, viewerPTID, mc.Source("self_private"), pageBudget)
	if err != nil {
		return nil, err
	}
	srcFollowedPublic, err := s.repos.PublicPosts.ListPublicByAuthors(ctx, followingPTIDs, mc.Source("followed_public"), pageBudget)
	if err != nil {
		return nil, err
	}
	srcFollowedFollowers, err := s.repos.PrivatePosts.ListByFollowingForViewer(ctx, viewerPTID, followingPTIDs, mc.Source("followed_followers"), pageBudget)
	if err != nil {
		return nil, err
	}
	srcCircles, err := s.repos.PrivatePosts.ListByCirclesForViewer(ctx, viewerPTID, circleIDs, mc.Source("circles"), pageBudget)
	if err != nil {
		return nil, err
	}
	srcGroups, err := s.repos.PrivatePosts.ListByGroupsForViewer(ctx, viewerPTID, groupIDs, mc.Source("groups"), pageBudget)
	if err != nil {
		return nil, err
	}

	type src struct {
		name  string
		posts []*domain.Post
	}
	sources := []src{
		{"self_public", srcSelfPublic},
		{"self_private", srcSelfPrivate},
		{"followed_public", srcFollowedPublic},
		{"followed_followers", srcFollowedFollowers},
		{"circles", srcCircles},
		{"groups", srcGroups},
	}

	merged := make([]*domain.Post, 0, pageBudget)
	srcOf := make(map[*domain.Post]string)
	for _, s := range sources {
		for _, p := range s.posts {
			merged = append(merged, p)
			srcOf[p] = s.name
		}
	}
	sortPostsByCreatedAtDesc(merged)
	if len(merged) > pageBudget {
		merged = merged[:pageBudget]
	}
	hasMore := len(merged) > limit
	if hasMore {
		merged = merged[:limit]
	}
	scannedCount := len(merged)
	if err := markBlockedAuthors(ctx, &viewer, s.repos, postAuthorPTIDs(merged)); err != nil {
		return nil, fmt.Errorf("mark blocked authors: %w", err)
	}

	srcLastScanned := make(map[string]*domain.Post)
	for _, p := range merged {
		srcLastScanned[srcOf[p]] = p
	}
	readable := make([]*domain.Post, 0, len(merged))
	for _, p := range merged {
		if ok, _ := domain.CanRead(viewer, p.AuthorPTID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	posts := s.moments.hydratePosts(ctx, readable, viewerPTID)
	posts, err = s.applyStationModeration(ctx, posts)
	if err != nil {
		return nil, err
	}
	reasonsByPostID := make(map[string]model.RelationshipReason_Kind, len(readable))
	for _, p := range readable {
		if p == nil {
			continue
		}
		audienceKind := model.Audience_PUBLIC
		if p.Audience != nil {
			audienceKind = p.Audience.Kind
		}
		reasonsByPostID[strconv.FormatUint(p.ID, 10)] = timelineReasonFromSource(srcOf[p], audienceKind)
	}

	if !hasMore {
		return finalizeTimelineResponse(&model.GetTimelineResponse{
			Posts:        posts,
			Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
		}, scannedCount), nil
	}

	nextMC := domain.MultiSourceCursor{}
	for _, name := range []string{"self_public", "self_private", "followed_public", "followed_followers", "circles", "groups"} {
		if last, ok := srcLastScanned[name]; ok {
			cur := domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}
			nextMC.SetSource(name, &cur)
		}
	}
	return finalizeTimelineResponse(&model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextMC.Encode(),
		HasMore:      true,
		Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
	}, scannedCount), nil
}

func finalizeTimelineResponse(
	response *model.GetTimelineResponse,
	scannedCount int,
) *model.GetTimelineResponse {
	if response == nil {
		response = &model.GetTimelineResponse{}
	}
	if scannedCount < len(response.Posts) {
		scannedCount = len(response.Posts)
	}
	filteredCount := scannedCount - len(response.Posts)
	response.PolicySummary = &model.TimelinePolicySummary{
		ScannedCount:  uint32(scannedCount),
		FilteredCount: uint32(filteredCount),
	}
	switch {
	case len(response.Posts) > 0:
		response.Outcome = model.TimelinePageOutcome_TIMELINE_PAGE_OUTCOME_ITEMS
	case scannedCount > 0:
		response.Outcome = model.TimelinePageOutcome_TIMELINE_PAGE_OUTCOME_FILTERED_EMPTY
	default:
		response.Outcome = model.TimelinePageOutcome_TIMELINE_PAGE_OUTCOME_EMPTY
	}
	return response
}

func (s *TimelineService) applyStationModeration(ctx context.Context, posts []*model.Post) ([]*model.Post, error) {
	if len(posts) == 0 || s.repos == nil || s.repos.Moderation == nil {
		return posts, nil
	}
	blocked, err := s.repos.Moderation.ListBlockedStations(ctx)
	if err != nil {
		return nil, fmt.Errorf("list blocked stations: %w", err)
	}
	return filterStationBlockedFeedPosts(posts, blocked), nil
}

// sortPostsByCreatedAtDesc sorts in place by (created_at DESC, id DESC)
// — same total order the per-source SQL queries produce, so the merge
// is stable.
func sortPostsByCreatedAtDesc(posts []*domain.Post) {
	// In-place insertion sort: small inputs (≤ 6×limit ≈ 120) make
	// the algorithmic complexity irrelevant and keeps the code
	// dependency-free. If the page budget grows we can swap in
	// `sort.Slice` without changing semantics.
	for i := 1; i < len(posts); i++ {
		j := i
		for j > 0 && postNewer(posts[j], posts[j-1]) {
			posts[j], posts[j-1] = posts[j-1], posts[j]
			j--
		}
	}
}

type timelineItem struct {
	source   string
	post     *domain.Post
	wire     *model.Post
	delivery *domain.MomentDelivery
	filtered bool
}

func (i timelineItem) deliveryAudienceKind() model.Audience_Kind {
	if i.delivery != nil {
		return parseDeliveryAudienceKind(i.delivery.AudienceKind)
	}
	if i.post != nil {
		if i.post.Audience != nil {
			return i.post.Audience.Kind
		}
		return model.Audience_PUBLIC
	}
	if i.wire != nil && i.wire.GetAudience() != nil {
		return i.wire.GetAudience().GetKind()
	}
	return model.Audience_KIND_UNSPECIFIED
}

func parseDeliveryAudienceKind(kind string) model.Audience_Kind {
	if kind == "" {
		return model.Audience_KIND_UNSPECIFIED
	}
	if value, ok := model.Audience_Kind_value[kind]; ok {
		return model.Audience_Kind(value)
	}
	return model.Audience_KIND_UNSPECIFIED
}

func sortTimelineItems(items []timelineItem) {
	for i := 1; i < len(items); i++ {
		j := i
		for j > 0 && timelineItemNewer(items[j], items[j-1]) {
			items[j], items[j-1] = items[j-1], items[j]
			j--
		}
	}
}

func timelineItemNewer(a, b timelineItem) bool {
	if a.post == nil {
		return false
	}
	if b.post == nil {
		return true
	}
	if a.post.CreatedAt.After(b.post.CreatedAt) {
		return true
	}
	if a.post.CreatedAt.Equal(b.post.CreatedAt) {
		return a.post.ID > b.post.ID
	}
	return false
}
