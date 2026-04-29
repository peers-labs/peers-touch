package application

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// Hot timeline tests.
//
// The HOT sort dispatches to PublicPostRepository.ListPublicHot, which
// in P2 uses the simplest portable score: `comments_count` ranked
// DESC, with `(created_at DESC, id DESC)` as deterministic
// tie-breakers, restricted to the last 7 days.
//
// We cannot mutate `comments_count` through the application surface
// (CommentService updates it via the comment count delta — but
// creating that many comments would be slow and noisy), so we
// directly UPDATE the column to seed the engagement signal.
//
// The tests pin two invariants:
//
//  1. Higher-engagement posts surface above lower-engagement ones,
//     even when newer posts exist (i.e. HOT actually re-orders the
//     feed; it is NOT just RECENT in disguise).
//  2. The timeline service correctly threads through to ListPublicHot
//     when `req.Sort == TIMELINE_SORT_HOT`.

func TestTimelineHot_RanksByEngagementOverRecency(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)

	old, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("popular old post"),
	}, author)
	if err != nil {
		t.Fatalf("create old: %v", err)
	}
	mid, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("medium engagement"),
	}, author)
	if err != nil {
		t.Fatalf("create mid: %v", err)
	}
	newest, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("freshest post — no engagement yet"),
	}, author)
	if err != nil {
		t.Fatalf("create newest: %v", err)
	}

	// Boost the engagement signal directly. The HOT score
	// formula is `comments_count` (highest wins), so writing
	// values directly is the cleanest way to assert ordering.
	if err := f.gdb.Model(&db.SocialPublicPost{}).
		Where("id = ?", old.Id).
		Update("comments_count", 100).Error; err != nil {
		t.Fatalf("seed old comments_count: %v", err)
	}
	if err := f.gdb.Model(&db.SocialPublicPost{}).
		Where("id = ?", mid.Id).
		Update("comments_count", 50).Error; err != nil {
		t.Fatalf("seed mid comments_count: %v", err)
	}

	resp, err := f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:  model.TimelineType_TIMELINE_PUBLIC,
		Sort:  model.TimelineSort_TIMELINE_SORT_HOT,
		Limit: 10,
	}, /*viewer*/ 0)
	if err != nil {
		t.Fatalf("get hot timeline: %v", err)
	}
	if len(resp.Posts) != 3 {
		t.Fatalf("expected 3 posts, got %d", len(resp.Posts))
	}

	// Expected order: old (100) > mid (50) > newest (0).
	if resp.Posts[0].Id != old.Id {
		t.Fatalf("rank[0] expected old (popular), got %s", resp.Posts[0].Id)
	}
	if resp.Posts[1].Id != mid.Id {
		t.Fatalf("rank[1] expected mid, got %s", resp.Posts[1].Id)
	}
	if resp.Posts[2].Id != newest.Id {
		t.Fatalf("rank[2] expected newest (zero engagement), got %s", resp.Posts[2].Id)
	}
}

func TestTimelineHot_RecentSortStillUsesCreatedAt(t *testing.T) {
	// Sanity: omitting Sort (defaults to RECENT) preserves the
	// original behaviour. This guards against an accidental
	// regression where every public timeline request silently
	// became HOT.
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)

	first, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("first"),
	}, author)
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("second"),
	}, author)
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	// Boost the older post's engagement to confirm RECENT
	// ignores it (i.e. would NOT promote it the way HOT does).
	if err := f.gdb.Model(&db.SocialPublicPost{}).
		Where("id = ?", first.Id).
		Update("comments_count", 999).Error; err != nil {
		t.Fatalf("seed first comments_count: %v", err)
	}

	resp, err := f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:  model.TimelineType_TIMELINE_PUBLIC,
		Limit: 10,
	}, 0)
	if err != nil {
		t.Fatalf("get recent timeline: %v", err)
	}
	if len(resp.Posts) != 2 {
		t.Fatalf("expected 2 posts, got %d", len(resp.Posts))
	}
	if resp.Posts[0].Id != second.Id {
		t.Fatalf("RECENT rank[0] should be the newer post; got %s, want %s", resp.Posts[0].Id, second.Id)
	}
}
