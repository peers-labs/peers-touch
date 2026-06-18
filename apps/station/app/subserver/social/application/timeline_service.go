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
func (s *TimelineService) GetTimeline(ctx context.Context, req *model.GetTimelineRequest, viewerID uint64) (*model.GetTimelineResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	switch req.Type {
	case model.TimelineType_TIMELINE_PUBLIC:
		if req.Sort == model.TimelineSort_TIMELINE_SORT_HOT {
			return s.getPublicHotTimeline(ctx, req.Cursor, limit, viewerID)
		}
		return s.getPublicTimeline(ctx, req.Cursor, limit, viewerID)
	case model.TimelineType_TIMELINE_USER:
		userID := domain.ParseID(req.UserId)
		if userID == 0 {
			return nil, fmt.Errorf("invalid user_id")
		}
		posts, nextCursor, hasMore, err := s.moments.ListByAuthor(ctx, userID, viewerID, req.Cursor, limit)
		if err != nil {
			return nil, err
		}
		posts, err = s.applyStationModeration(ctx, posts)
		if err != nil {
			return nil, err
		}
		return &model.GetTimelineResponse{
			Posts:        posts,
			NextCursor:   nextCursor,
			HasMore:      hasMore,
			Explanations: buildFeedObjectExplanations(posts, nil, model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW),
		}, nil
	case model.TimelineType_TIMELINE_HOME:
		return s.getHomeTimeline(ctx, req.Cursor, limit, viewerID)
	default:
		return nil, fmt.Errorf("unsupported timeline type %s", req.Type)
	}
}

// getPublicTimeline returns the global public-only feed. Uses a
// single-source cursor — no merge necessary because only the public
// table is involved.
func (s *TimelineService) getPublicTimeline(ctx context.Context, cursor string, limit int, viewerID uint64) (*model.GetTimelineResponse, error) {
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
	viewer, err := buildViewerForAuthors(ctx, viewerID, s.repos, s.resolver.ResolveID, s.groups, postAuthorIDs(rows))
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	readable := rows[:0]
	for _, p := range rows {
		if ok, _ := domain.CanRead(viewer, p.AuthorID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	rows = readable
	posts := s.moments.hydratePosts(ctx, rows, viewerID)
	posts, err = s.applyStationModeration(ctx, posts)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(scannedRows) > 0 {
		last := scannedRows[len(scannedRows)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return &model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextCursor,
		HasMore:      hasMore,
		Explanations: buildFeedObjectExplanations(posts, nil, model.RelationshipReason_RELATIONSHIP_REASON_PUBLIC_FEDERATED),
	}, nil
}

// getPublicHotTimeline returns the trending public feed. Repo
// computes the score in SQL and orders by it; we only need to encode
// the next cursor from the last row of the page.
func (s *TimelineService) getPublicHotTimeline(ctx context.Context, cursor string, limit int, viewerID uint64) (*model.GetTimelineResponse, error) {
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
	viewer, err := buildViewerForAuthors(ctx, viewerID, s.repos, s.resolver.ResolveID, s.groups, postAuthorIDs(rows))
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	readable := rows[:0]
	for _, p := range rows {
		if ok, _ := domain.CanRead(viewer, p.AuthorID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	rows = readable
	posts := s.moments.hydratePosts(ctx, rows, viewerID)
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
	return &model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextCursor,
		HasMore:      hasMore,
		Explanations: buildFeedObjectExplanations(posts, nil, model.RelationshipReason_RELATIONSHIP_REASON_PUBLIC_FEDERATED),
	}, nil
}

// getHomeTimeline merges the six sources described in the package
// header. Anonymous viewers (viewerID == 0) get an empty result —
// "home" is meaningless without an identity. Plan callers should
// dispatch them to the public timeline instead; we keep the empty
// behaviour here so a misrouted call doesn't 500.
func (s *TimelineService) getHomeTimeline(ctx context.Context, cursor string, limit int, viewerID uint64) (*model.GetTimelineResponse, error) {
	if s.repos.Deliveries == nil {
		return s.getLegacyHomeTimeline(ctx, cursor, limit, viewerID)
	}
	return s.getDeliveryHomeTimeline(ctx, cursor, limit, viewerID)
}

func (s *TimelineService) getDeliveryHomeTimeline(ctx context.Context, cursor string, limit int, viewerID uint64) (*model.GetTimelineResponse, error) {
	if viewerID == 0 {
		return &model.GetTimelineResponse{}, nil
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

	viewer, err := buildViewer(ctx, viewerID, s.repos, s.resolver.ResolveID, s.groups)
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}
	followingIDs := make([]uint64, 0, len(viewer.Following))
	for id := range viewer.Following {
		followingIDs = append(followingIDs, id)
	}

	pageBudget := limit + 1
	deliveries, err := s.repos.Deliveries.ListInbox(ctx, viewerID, mc.Source("delivery"), pageBudget)
	if err != nil {
		return nil, err
	}
	selfPublic, _ := s.repos.PublicPosts.ListByAuthor(ctx, viewerID, mc.Source("self_public"), pageBudget)
	followedPublic, _ := s.repos.PublicPosts.ListPublicByAuthors(ctx, followingIDs, mc.Source("followed_public"), pageBudget)

	items := make([]timelineItem, 0, len(deliveries)+len(selfPublic)+len(followedPublic))
	for i := range deliveries {
		d := deliveries[i]
		post, err := s.moments.GetMoment(ctx, fmt.Sprintf("%d", d.PostID), viewerID)
		if err != nil {
			return nil, err
		}
		if post == nil {
			continue
		}
		domainPost := &domain.Post{ID: d.PostID, AuthorID: d.AuthorID, CreatedAt: d.DeliveredAt}
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

	posts := make([]*model.Post, 0, len(items))
	reasonsByPostID := make(map[string]model.RelationshipReason_Kind, len(items))
	srcLastSeen := make(map[string]timelineItem)
	for _, item := range items {
		var wirePost *model.Post
		if item.wire != nil {
			wirePost = item.wire
		} else if item.post != nil {
			got := s.moments.hydratePosts(ctx, []*domain.Post{item.post}, viewerID)
			if len(got) > 0 {
				wirePost = got[0]
			}
		}
		if wirePost != nil {
			posts = append(posts, wirePost)
			reasonsByPostID[wirePost.GetId()] = timelineReasonFromSource(item.source, item.deliveryAudienceKind())
		}
		srcLastSeen[item.source] = item
	}
	posts, err = s.applyStationModeration(ctx, posts)
	if err != nil {
		return nil, err
	}

	if !hasMore {
		return &model.GetTimelineResponse{
			Posts:        posts,
			Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
		}, nil
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
	return &model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextMC.Encode(),
		HasMore:      true,
		Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
	}, nil
}

func (s *TimelineService) getLegacyHomeTimeline(ctx context.Context, cursor string, limit int, viewerID uint64) (*model.GetTimelineResponse, error) {
	if viewerID == 0 {
		return &model.GetTimelineResponse{}, nil
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

	viewer, err := buildViewer(ctx, viewerID, s.repos, s.resolver.ResolveID, s.groups)
	if err != nil {
		return nil, fmt.Errorf("build viewer: %w", err)
	}

	followingIDs := make([]uint64, 0, len(viewer.Following))
	for id := range viewer.Following {
		followingIDs = append(followingIDs, id)
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

	srcSelfPublic, _ := s.repos.PublicPosts.ListByAuthor(ctx, viewerID, mc.Source("self_public"), pageBudget)
	srcSelfPrivate, _ := s.repos.PrivatePosts.ListByAuthorVisibleTo(ctx, viewerID, viewerID, mc.Source("self_private"), pageBudget)
	srcFollowedPublic, _ := s.repos.PublicPosts.ListPublicByAuthors(ctx, followingIDs, mc.Source("followed_public"), pageBudget)
	srcFollowedFollowers, _ := s.repos.PrivatePosts.ListByFollowingForViewer(ctx, viewerID, followingIDs, mc.Source("followed_followers"), pageBudget)
	srcCircles, _ := s.repos.PrivatePosts.ListByCirclesForViewer(ctx, viewerID, circleIDs, mc.Source("circles"), pageBudget)
	srcGroups, _ := s.repos.PrivatePosts.ListByGroupsForViewer(ctx, viewerID, groupIDs, mc.Source("groups"), pageBudget)

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
	if err := markBlockedAuthors(ctx, &viewer, s.repos, postAuthorIDs(merged)); err != nil {
		return nil, fmt.Errorf("mark blocked authors: %w", err)
	}

	srcLastScanned := make(map[string]*domain.Post)
	for _, p := range merged {
		srcLastScanned[srcOf[p]] = p
	}
	readable := make([]*domain.Post, 0, len(merged))
	for _, p := range merged {
		if ok, _ := domain.CanRead(viewer, p.AuthorID, p.Audience, p.IsDeleted()); !ok {
			continue
		}
		readable = append(readable, p)
	}
	posts := s.moments.hydratePosts(ctx, readable, viewerID)
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
		return &model.GetTimelineResponse{
			Posts:        posts,
			Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
		}, nil
	}

	nextMC := domain.MultiSourceCursor{}
	for _, name := range []string{"self_public", "self_private", "followed_public", "followed_followers", "circles", "groups"} {
		if last, ok := srcLastScanned[name]; ok {
			cur := domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}
			nextMC.SetSource(name, &cur)
		}
	}
	return &model.GetTimelineResponse{
		Posts:        posts,
		NextCursor:   nextMC.Encode(),
		HasMore:      true,
		Explanations: buildFeedObjectExplanations(posts, reasonsByPostID, model.RelationshipReason_RELATIONSHIP_REASON_UNKNOWN),
	}, nil
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
}

func (i timelineItem) deliveryAudienceKind() model.Audience_Kind {
	if i.delivery != nil {
		return i.delivery.AudienceKind
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
