package application

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// fixtureDBSeq guarantees a unique in-memory shared-cache DSN per
// test. We MUST use `cache=shared` (otherwise GORM's connection pool
// would each see a fresh per-connection :memory: DB and migrations
// applied on one connection would be invisible to another), but
// without per-test isolation that single shared cache leaks state
// across tests run in the same package binary.
var fixtureDBSeq atomic.Uint64

type applicationTestStore struct {
	mu sync.RWMutex
	db *gorm.DB
}

func (*applicationTestStore) Init(context.Context, ...option.Option) error { return nil }

func (s *applicationTestStore) RDS(context.Context, ...store.RDSDMLOption) (*gorm.DB, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db, nil
}

func (*applicationTestStore) Name() string { return "social-application-test-store" }

func (s *applicationTestStore) setDB(db *gorm.DB) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.db = db
}

var (
	applicationFixtureMu    sync.Mutex
	applicationStore        = &applicationTestStore{}
	applicationStoreOnce    sync.Once
	applicationStoreInitErr error
)

// These tests exercise the full Moments stack — repository ↔ application
// service ↔ domain validation ↔ CanRead — against an ephemeral sqlite
// in-memory DB. They lock in the architectural invariants that any
// future refactor must preserve:
//
//   - Storage separation: PUBLIC posts in `social_public_posts`,
//     non-PUBLIC in `social_private_posts` (Create panics on misroute).
//   - Audience-filtered reads: PUBLIC visible to anonymous; SELF
//     visible only to author; FOLLOWERS only to followers.
//   - Reaction snapshot refresh on toggle.
//   - Comment visibility inheritance from the parent post + 1-level
//     reply nesting enforcement.
//   - Soft-delete tombstoning (deleted posts invisible to everyone,
//     including the author).
//
// We deliberately don't seed the actor table — the hydration path
// tolerates a missing actor (Author field stays nil) and we assert on
// the structural invariants rather than display fields.

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type fixture struct {
	gdb       *gorm.DB
	repos     *infrastructure.Repos
	moments   *MomentService
	reactions *ReactionService
	circles   *CircleService
	comments  *CommentService
	timeline  *TimelineService
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	dsn := fmt.Sprintf("file:moments_test_%d?mode=memory&cache=shared&_pragma=foreign_keys(1)", fixtureDBSeq.Add(1))
	gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(
		&db.Actor{},
		&db.SocialPublicPost{},
		&db.SocialPrivatePost{},
		&db.SocialMomentDelivery{},
		&db.SocialPrivateAudienceGrant{},
		&db.SocialComment{},
		&db.SocialReaction{},
		&db.SocialCircle{},
		&db.SocialCircleMember{},
		&db.SocialStationModerationPolicy{},
		&db.Follow{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := gdb.Exec(`
CREATE TABLE friend_chat_friendships (
	id integer primary key autoincrement,
	actor_ptid text,
	peer_ptid text,
	status integer,
	created_at datetime,
	updated_at datetime
)`).Error; err != nil {
		t.Fatalf("migrate friendships: %v", err)
	}
	bindApplicationActorStore(t, gdb)
	seedFixtureActors(t, gdb)

	resolver := NewNoopActorResolver()
	groups := NewNoopGroupMembershipChecker()
	repos := infrastructure.NewRepos(gdb)

	reactions := NewReactionService(gdb, repos)
	// Tests use the no-op MediaResolver so existing fixtures can keep
	// fabricating CIDs (`oss://station.local/...`); a dedicated test
	// in `moment_service_image_test.go` covers the real resolver.
	moments := NewMomentService(gdb, repos, resolver, groups, NewNoopMediaResolver(), reactions)
	comments := NewCommentService(repos, moments)
	circles := NewCircleService(repos)
	timeline := NewTimelineService(repos, moments, resolver, groups)

	return &fixture{
		gdb:       gdb,
		repos:     repos,
		moments:   moments,
		reactions: reactions,
		circles:   circles,
		comments:  comments,
		timeline:  timeline,
	}
}

func bindApplicationActorStore(t *testing.T, gdb *gorm.DB) {
	t.Helper()
	applicationFixtureMu.Lock()
	t.Cleanup(applicationFixtureMu.Unlock)
	applicationStoreOnce.Do(func() {
		applicationStoreInitErr = store.InjectStore(context.Background(), applicationStore)
	})
	if applicationStoreInitErr != nil {
		t.Fatalf("inject actor store: %v", applicationStoreInitErr)
	}
	applicationStore.setDB(gdb)
}

func seedFixtureActors(t *testing.T, gdb *gorm.DB) {
	t.Helper()
	for _, actorID := range []uint64{1, 2, 3, 7, 9, 42, 100, 101, 200, 300, 400, 500, 600, 700, 999} {
		record := &db.Actor{
			ID:                actorID,
			PTID:              fixturePTID(actorID),
			Namespace:         "peers",
			PreferredUsername: fmt.Sprintf("user-%d", actorID),
			Email:             fmt.Sprintf("user-%d@example.test", actorID),
			PasswordHash:      "test-only",
			FederatedHandle:   fmt.Sprintf("@user-%d@test.local", actorID),
		}
		if err := gdb.Create(record).Error; err != nil {
			t.Fatalf("seed actor %d: %v", actorID, err)
		}
	}
}

// seedFollow records `follower → following` directly via the repo (skipping
// RelationshipService to keep the test free of subject-extraction
// concerns).
func seedFollow(t *testing.T, f *fixture, follower, following uint64) {
	t.Helper()
	followerPTID := fixturePTID(follower)
	followingPTID := fixturePTID(following)
	if err := f.repos.Follows.Follow(context.Background(), followerPTID, followingPTID); err != nil {
		t.Fatalf("seed follow %d->%d: %v", follower, following, err)
	}
}

func seedBlock(t *testing.T, f *fixture, actorID, peerID uint64) {
	t.Helper()
	if err := f.gdb.Exec(
		"INSERT INTO friend_chat_friendships (actor_ptid, peer_ptid, status) VALUES (?, ?, 3)",
		fixturePTID(actorID),
		fixturePTID(peerID),
	).Error; err != nil {
		t.Fatalf("seed block %d->%d: %v", actorID, peerID, err)
	}
}

func textBody(text string) *model.CreatePostRequest_Text {
	return &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: text}}
}

// ---------------------------------------------------------------------------
// Storage separation
// ---------------------------------------------------------------------------

func TestStorageSeparation_PublicLandsInPublicTable(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("hello world"),
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var pubCount, privCount int64
	f.gdb.Model(&db.SocialPublicPost{}).Count(&pubCount)
	f.gdb.Model(&db.SocialPrivatePost{}).Count(&privCount)
	if pubCount != 1 || privCount != 0 {
		t.Fatalf("expected 1 public + 0 private rows, got pub=%d priv=%d", pubCount, privCount)
	}

	if post.Audience == nil || post.Audience.Kind != model.Audience_PUBLIC {
		t.Fatalf("returned audience kind = %v, want PUBLIC", post.Audience)
	}
}

func TestStorageSeparation_FollowersLandsInPrivateTable(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	if _, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("for my followers"),
	}, fixturePTID(100)); err != nil {
		t.Fatalf("create: %v", err)
	}

	var pubCount, privCount int64
	f.gdb.Model(&db.SocialPublicPost{}).Count(&pubCount)
	f.gdb.Model(&db.SocialPrivatePost{}).Count(&privCount)
	if pubCount != 0 || privCount != 1 {
		t.Fatalf("expected 0 public + 1 private row, got pub=%d priv=%d", pubCount, privCount)
	}
}

// ---------------------------------------------------------------------------
// Audience-filtered reads
// ---------------------------------------------------------------------------

func TestRead_PublicVisibleToAnonymous(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("public note"),
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := f.moments.GetMoment(ctx, created.Id, "")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil {
		t.Fatal("anonymous viewer should be able to read PUBLIC post")
	}
}

func TestRead_SelfOnlyVisibleToAuthor(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_SELF},
		Content:  textBody("dear diary"),
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(100)); got == nil {
		t.Fatal("author should always see their own SELF post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(200)); got != nil {
		t.Fatal("non-author must not see SELF post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, ""); got != nil {
		t.Fatal("anonymous viewer must not see SELF post")
	}
}

func TestRead_FollowersOnlyVisibleToFollowers(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, follower, stranger = uint64(100), uint64(200), uint64(300)
	seedFollow(t, f, follower, author)

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("followers only"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(author)); got == nil {
		t.Fatal("author must see their own FOLLOWERS post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(follower)); got == nil {
		t.Fatal("follower must see FOLLOWERS post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(stranger)); got != nil {
		t.Fatal("stranger must not see FOLLOWERS post")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, ""); got != nil {
		t.Fatal("anonymous viewer must not see FOLLOWERS post")
	}
}

func TestRead_BlockedViewerCannotReadFollowersOnlyPost(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, follower = uint64(100), uint64(200)
	seedFollow(t, f, follower, author)
	seedBlock(t, f, author, follower)

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("blocked followers cannot read"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(follower)); got != nil {
		t.Fatal("blocked follower must not read FOLLOWERS post")
	}
}

func TestRead_BlockCannotBeBypassedByAudienceKinds(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, viewer = uint64(100), uint64(200)
	seedBlock(t, f, viewer, author)

	for _, tc := range []struct {
		name     string
		audience *model.Audience
	}{
		{"public", &model.Audience{Kind: model.Audience_PUBLIC}},
		{"custom_allow", &model.Audience{Kind: model.Audience_CUSTOM_ALLOW, ActorPtids: []string{fixturePTID(viewer)}}},
		{"custom_deny_public", &model.Audience{Kind: model.Audience_CUSTOM_DENY, BaseKind: model.Audience_PUBLIC, ActorPtids: []string{fixturePTID(300)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
				Type:     model.PostType_TEXT,
				Audience: tc.audience,
				Content:  textBody(tc.name),
			}, fixturePTID(author))
			if err != nil {
				t.Fatalf("create: %v", err)
			}
			if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(viewer)); got != nil {
				t.Fatalf("blocked viewer must not read %s post", tc.name)
			}
		})
	}
}

func TestTimeline_BlockGraphFiltersPublicAndHomeFeeds(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, viewer = uint64(100), uint64(200)
	seedFollow(t, f, viewer, author)
	seedBlock(t, f, author, viewer)

	publicPost, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("public but blocked"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create public: %v", err)
	}
	followersPost, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("followers but blocked"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create followers: %v", err)
	}

	publicTimeline, err := f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{Type: model.TimelineType_TIMELINE_PUBLIC, Limit: 20}, fixturePTID(viewer))
	if err != nil {
		t.Fatalf("public timeline: %v", err)
	}
	assertPostAbsent(t, publicTimeline.Posts, publicPost.Id)

	homeTimeline, err := f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{Type: model.TimelineType_TIMELINE_HOME, Limit: 20}, fixturePTID(viewer))
	if err != nil {
		t.Fatalf("home timeline: %v", err)
	}
	assertPostAbsent(t, homeTimeline.Posts, publicPost.Id)
	assertPostAbsent(t, homeTimeline.Posts, followersPost.Id)
}

func assertPostAbsent(t *testing.T, posts []*model.Post, postID string) {
	t.Helper()
	for _, post := range posts {
		if post != nil && post.Id == postID {
			t.Fatalf("post %s must be filtered from feed", postID)
		}
	}
}

// ---------------------------------------------------------------------------
// Soft-delete cascade
// ---------------------------------------------------------------------------

func TestDelete_TombstonesPostFromEveryone(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("ephemeral"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := f.moments.DeleteMoment(ctx, created.Id, fixturePTID(author)); err != nil {
		t.Fatalf("delete: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, fixturePTID(author)); got != nil {
		t.Fatal("author must not see deleted post (CanRead invariant 1)")
	}
	if got, _ := f.moments.GetMoment(ctx, created.Id, ""); got != nil {
		t.Fatal("anonymous viewer must not see deleted post")
	}
}

func TestDelete_ByNonAuthorIsNoop(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("not yours"),
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Different actor attempts to delete — silently no-op (no error,
	// no tombstone applied).
	if err := f.moments.DeleteMoment(ctx, created.Id /*non-author*/, fixturePTID(200)); err != nil {
		t.Fatalf("non-author delete should not error: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, created.Id, ""); got == nil {
		t.Fatal("post must remain visible after non-author delete attempt")
	}
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

func TestReact_AddRemoveAndSnapshotRefresh(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, viewer = uint64(100), uint64(200)
	created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("react to me"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	summaries, err := f.reactions.React(ctx, created.Id, fixturePTID(viewer), model.ReactionKind_REACTION_LIKE)
	if err != nil {
		t.Fatalf("react: %v", err)
	}
	if len(summaries) != 1 || summaries[0].Kind != model.ReactionKind_REACTION_LIKE || summaries[0].Count != 1 {
		t.Fatalf("after react: %+v", summaries)
	}
	if !summaries[0].ReactedByViewer {
		t.Fatal("reacted_by_viewer must be true for the reactor")
	}

	// Idempotent: re-reacting with same kind shouldn't duplicate.
	if _, err := f.reactions.React(ctx, created.Id, fixturePTID(viewer), model.ReactionKind_REACTION_LIKE); err != nil {
		t.Fatalf("re-react: %v", err)
	}
	var n int64
	f.gdb.Model(&db.SocialReaction{}).Count(&n)
	if n != 1 {
		t.Fatalf("re-react must be idempotent at composite-key level, got %d rows", n)
	}

	// Different kind from same viewer — second reaction allowed.
	if _, err := f.reactions.React(ctx, created.Id, fixturePTID(viewer), model.ReactionKind_REACTION_LOVE); err != nil {
		t.Fatalf("react LOVE: %v", err)
	}
	f.gdb.Model(&db.SocialReaction{}).Count(&n)
	if n != 2 {
		t.Fatalf("expected 2 reaction rows after LOVE, got %d", n)
	}

	// Snapshot refresh: the parent post's reactions_count_json should
	// reflect both kinds.
	var snapshot string
	f.gdb.Model(&db.SocialPublicPost{}).
		Select("reactions_count_json").
		Where("id = ?", domain.ParseID(created.Id)).
		Scan(&snapshot)
	if !strings.Contains(snapshot, "REACTION_LIKE") || !strings.Contains(snapshot, "REACTION_LOVE") {
		t.Fatalf("snapshot must include both kinds, got %q", snapshot)
	}

	// Unreact LIKE: should drop the count to zero for LIKE but keep
	// LOVE.
	if _, err := f.reactions.Unreact(ctx, created.Id, fixturePTID(viewer), model.ReactionKind_REACTION_LIKE); err != nil {
		t.Fatalf("unreact: %v", err)
	}
	f.gdb.Model(&db.SocialReaction{}).Count(&n)
	if n != 1 {
		t.Fatalf("expected 1 row after unreact, got %d", n)
	}
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

func TestComment_OneLevelReplyNesting(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("discussion starter"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	postID := domain.ParseID(post.Id)

	top, err := f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:  post.Id,
		Content: "first!",
	}, postID /*viewer*/, fixturePTID(200))
	if err != nil {
		t.Fatalf("create top-level comment: %v", err)
	}

	// Reply to a top-level comment is allowed.
	if _, err := f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:           post.Id,
		Content:          "second",
		ReplyToCommentId: top.Id,
	}, postID /*viewer*/, fixturePTID(300)); err != nil {
		t.Fatalf("reply to top-level: %v", err)
	}

	// Reply to a reply must be rejected (one-level nesting).
	var lastReplyID string
	{
		// Re-fetch the second comment so we have its id.
		resp, _ := f.comments.ListByPost(ctx, postID, fixturePTID(author), "", 50)
		for _, c := range resp.Comments {
			if c.ReplyToCommentId == top.Id {
				lastReplyID = c.Id
				break
			}
		}
	}
	if lastReplyID == "" {
		t.Fatal("could not locate reply for two-level test")
	}
	_, err = f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:           post.Id,
		Content:          "third",
		ReplyToCommentId: lastReplyID,
	}, postID /*viewer*/, fixturePTID(400))
	if err == nil || !strings.Contains(err.Error(), "one-level nesting") {
		t.Fatalf("two-level reply must be rejected, got err=%v", err)
	}
}

func TestComment_VisibilityInheritsFromPost(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_SELF},
		Content:  textBody("private thought"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	postID := domain.ParseID(post.Id)

	// Non-author cannot create a comment on a SELF post (parent
	// invisibility cascades).
	if _, err := f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:  post.Id,
		Content: "hi",
	}, postID /*non-author*/, fixturePTID(200)); err == nil {
		t.Fatal("non-author must not be able to comment on SELF post")
	}

	// Author can.
	if _, err := f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:  post.Id,
		Content: "self-note",
	}, postID, fixturePTID(author)); err != nil {
		t.Fatalf("author comment on SELF post: %v", err)
	}
}

func TestComment_DecrementsCountOnDelete(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	post, _ := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("counter"),
	}, fixturePTID(author))
	postID := domain.ParseID(post.Id)

	c, _ := f.comments.CreateComment(ctx, &model.CreateCommentRequest{PostId: post.Id, Content: "a"}, postID, fixturePTID(200))
	c2, _ := f.comments.CreateComment(ctx, &model.CreateCommentRequest{PostId: post.Id, Content: "b"}, postID, fixturePTID(300))

	var afterCreate int64
	f.gdb.Model(&db.SocialPublicPost{}).Select("comments_count").Where("id = ?", postID).Scan(&afterCreate)
	if afterCreate != 2 {
		t.Fatalf("comments_count after 2 creates = %d, want 2", afterCreate)
	}
	_ = c2

	if err := f.comments.DeleteComment(ctx, domain.ParseID(c.Id), fixturePTID(200)); err != nil {
		t.Fatalf("delete: %v", err)
	}
	var afterDelete int64
	f.gdb.Model(&db.SocialPublicPost{}).Select("comments_count").Where("id = ?", postID).Scan(&afterDelete)
	if afterDelete != 1 {
		t.Fatalf("comments_count after 1 delete = %d, want 1", afterDelete)
	}
}

// ---------------------------------------------------------------------------
// Audience validation (rejected at the application boundary)
// ---------------------------------------------------------------------------

func TestCreateMoment_RejectsMissingAudience(t *testing.T) {
	f := newFixture(t)
	_, err := f.moments.CreateMoment(context.Background(), &model.CreatePostRequest{
		Type:    model.PostType_TEXT,
		Content: textBody("no audience"),
	}, fixturePTID(100))
	if err == nil {
		t.Fatal("missing audience must be rejected")
	}
}

func TestCreateMoment_RejectsInvalidAudienceShape(t *testing.T) {
	f := newFixture(t)
	cases := []struct {
		name string
		a    *model.Audience
	}{
		{"circle missing target", &model.Audience{Kind: model.Audience_CIRCLE}},
		{"custom_allow empty list", &model.Audience{Kind: model.Audience_CUSTOM_ALLOW}},
		{"custom_deny base CIRCLE", &model.Audience{
			Kind:       model.Audience_CUSTOM_DENY,
			BaseKind:   model.Audience_CIRCLE,
			ActorPtids: []string{"did:peers:x"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.moments.CreateMoment(context.Background(), &model.CreatePostRequest{
				Type:     model.PostType_TEXT,
				Audience: tc.a,
				Content:  textBody("invalid"),
			}, fixturePTID(100))
			if err == nil {
				t.Fatalf("expected reject for %s", tc.name)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Circle service basics (no PTID resolver in P1 — owner ops only)
// ---------------------------------------------------------------------------

func TestCircle_CreateRenameDelete(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const owner = uint64(100)

	created, err := f.circles.Create(ctx, &model.CreateCircleRequest{
		Name:        "Family",
		Description: "Parents + sibling",
	}, fixturePTID(owner))
	if err != nil {
		t.Fatalf("create circle: %v", err)
	}
	if created.GetOwnerPtid() != fixturePTID(owner) || created.Name != "Family" {
		t.Fatalf("created circle = %+v", created)
	}

	desc := "Updated description"
	renamed, err := f.circles.Rename(ctx, &model.RenameCircleRequest{
		CircleId:    created.Id,
		Name:        "Close Family",
		Description: &desc,
	}, fixturePTID(owner))
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Name != "Close Family" || renamed.Description != desc {
		t.Fatalf("rename did not apply: %+v", renamed)
	}

	// A different actor cannot delete.
	if err := f.circles.Delete(ctx, created.Id /*not-owner*/, fixturePTID(200)); err == nil {
		t.Fatal("non-owner delete must be rejected")
	}
	if err := f.circles.Delete(ctx, created.Id, fixturePTID(owner)); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
}

func TestCircle_AddRemoveMembersUpdatesDenormalCount(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const owner = uint64(100)
	created, _ := f.circles.Create(ctx, &model.CreateCircleRequest{Name: "Friends"}, fixturePTID(owner))

	added, total, err := f.circles.AddMembers(ctx, &model.AddCircleMemberRequest{
		CircleId:    created.Id,
		MemberPtids: []string{"did:peers:a", "did:peers:b", "did:peers:c"},
	}, fixturePTID(owner))
	if err != nil {
		t.Fatalf("add members: %v", err)
	}
	if added != 3 || total != 3 {
		t.Fatalf("added=%d total=%d, want 3/3", added, total)
	}

	// Re-add overlapping list — duplicates excluded from added_count.
	added, total, err = f.circles.AddMembers(ctx, &model.AddCircleMemberRequest{
		CircleId:    created.Id,
		MemberPtids: []string{"did:peers:b", "did:peers:c", "did:peers:d"},
	}, fixturePTID(owner))
	if err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if added != 1 || total != 4 {
		t.Fatalf("after re-add: added=%d total=%d, want 1/4", added, total)
	}

	removed, total, err := f.circles.RemoveMembers(ctx, &model.RemoveCircleMemberRequest{
		CircleId:    created.Id,
		MemberPtids: []string{"did:peers:a", "did:peers:zzz" /* not present */},
	}, fixturePTID(owner))
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if removed != 1 || total != 3 {
		t.Fatalf("after remove: removed=%d total=%d, want 1/3", removed, total)
	}

	// Denormalised count on the circle row matches.
	var dbCount int64
	f.gdb.Model(&db.SocialCircle{}).Select("member_count").Where("id = ?", created.Id).Scan(&dbCount)
	if dbCount != 3 {
		t.Fatalf("circle row member_count = %d, want 3", dbCount)
	}
}

// ---------------------------------------------------------------------------
// Visibility gates (P1 closure)
//
// These tests pin the contract the handler layer relies on: any
// endpoint that mutates a post-bound resource (react, list comments,
// repost) must FIRST gate on visibility via MomentService.GetMoment.
// The handler implementation is a 1-line delegation; the real
// invariant is "GetMoment returns nil for an unauthorised viewer",
// which we lock in here once for both wires.
// ---------------------------------------------------------------------------

func TestVisibilityGate_GetMomentIsNilForUnauthorisedViewer(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	const stranger = uint64(200)

	// SELF — only the author can read.
	selfPost, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_SELF},
		Content:  textBody("dear diary"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create SELF: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, selfPost.Id, fixturePTID(stranger)); got != nil {
		t.Fatalf("SELF post must be nil for stranger; got %+v", got)
	}
	if got, _ := f.moments.GetMoment(ctx, selfPost.Id, fixturePTID(author)); got == nil {
		t.Fatal("SELF post must be visible to author")
	}

	// FOLLOWERS — only followers can read.
	followersPost, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("for the inner circle"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create FOLLOWERS: %v", err)
	}

	if got, _ := f.moments.GetMoment(ctx, followersPost.Id, fixturePTID(stranger)); got != nil {
		t.Fatalf("FOLLOWERS post must be nil for non-follower; got %+v", got)
	}

	// Become a follower; now visible.
	seedFollow(t, f /*follower*/, stranger /*following*/, author)
	if got, _ := f.moments.GetMoment(ctx, followersPost.Id, fixturePTID(stranger)); got == nil {
		t.Fatal("FOLLOWERS post must be visible after follow")
	}
}

func TestDeliveryInbox_FollowersMomentLandsInFollowerHome(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	const follower = uint64(200)
	const stranger = uint64(300)
	seedFollow(t, f, follower, author)

	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("followers only"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create FOLLOWERS: %v", err)
	}

	got, err := f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:  model.TimelineType_TIMELINE_HOME,
		Limit: 20,
	}, fixturePTID(follower))
	if err != nil {
		t.Fatalf("follower home: %v", err)
	}
	if !timelineContainsPost(got, post.Id) {
		t.Fatalf("follower HOME missing delivered post %s", post.Id)
	}

	got, err = f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:  model.TimelineType_TIMELINE_HOME,
		Limit: 20,
	}, fixturePTID(stranger))
	if err != nil {
		t.Fatalf("stranger home: %v", err)
	}
	if timelineContainsPost(got, post.Id) {
		t.Fatalf("stranger HOME must not include delivered post %s", post.Id)
	}
}

func TestDeliveryInbox_DeleteRevokesDeliveredMoment(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	const follower = uint64(200)
	seedFollow(t, f, follower, author)

	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_FOLLOWERS},
		Content:  textBody("temporary"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create FOLLOWERS: %v", err)
	}
	if err := f.moments.DeleteMoment(ctx, post.Id, fixturePTID(author)); err != nil {
		t.Fatalf("delete: %v", err)
	}

	got, err := f.timeline.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:  model.TimelineType_TIMELINE_HOME,
		Limit: 20,
	}, fixturePTID(follower))
	if err != nil {
		t.Fatalf("follower home: %v", err)
	}
	if timelineContainsPost(got, post.Id) {
		t.Fatalf("follower HOME must not include revoked post %s", post.Id)
	}
}

func timelineContainsPost(resp *model.GetTimelineResponse, postID string) bool {
	if resp == nil {
		return false
	}
	for _, post := range resp.Posts {
		if post.GetId() == postID {
			return true
		}
	}
	return false
}

func TestInteractionVisibility_FiltersThirdPartyCommentsAndReactions(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	const viewer = uint64(200)
	const mutual = uint64(300)
	const stranger = uint64(400)

	seedFollow(t, f, viewer, mutual)
	seedFollow(t, f, mutual, viewer)

	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("public, private interactions"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	postID := domain.ParseID(post.Id)

	if _, err := f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:  post.Id,
		Content: "mutual can be seen",
	}, postID, fixturePTID(mutual)); err != nil {
		t.Fatalf("mutual comment: %v", err)
	}
	if _, err := f.comments.CreateComment(ctx, &model.CreateCommentRequest{
		PostId:  post.Id,
		Content: "stranger must be hidden",
	}, postID, fixturePTID(stranger)); err != nil {
		t.Fatalf("stranger comment: %v", err)
	}

	viewerComments, err := f.comments.ListByPost(ctx, postID, fixturePTID(viewer), "", 20)
	if err != nil {
		t.Fatalf("viewer comments: %v", err)
	}
	if len(viewerComments.Comments) != 1 || viewerComments.Comments[0].Content != "mutual can be seen" {
		t.Fatalf("viewer comments = %+v, want only mutual comment", viewerComments.Comments)
	}

	authorComments, err := f.comments.ListByPost(ctx, postID, fixturePTID(author), "", 20)
	if err != nil {
		t.Fatalf("author comments: %v", err)
	}
	if len(authorComments.Comments) != 2 {
		t.Fatalf("author should see all comments, got %d", len(authorComments.Comments))
	}

	if _, err := f.reactions.React(ctx, post.Id, fixturePTID(mutual), model.ReactionKind_REACTION_LIKE); err != nil {
		t.Fatalf("mutual react: %v", err)
	}
	if _, err := f.reactions.React(ctx, post.Id, fixturePTID(stranger), model.ReactionKind_REACTION_LIKE); err != nil {
		t.Fatalf("stranger react: %v", err)
	}

	viewerPost, err := f.moments.GetMoment(ctx, post.Id, fixturePTID(viewer))
	if err != nil {
		t.Fatalf("viewer get moment: %v", err)
	}
	if got := reactionCount(viewerPost, model.ReactionKind_REACTION_LIKE); got != 1 {
		t.Fatalf("viewer LIKE count = %d, want 1", got)
	}

	authorPost, err := f.moments.GetMoment(ctx, post.Id, fixturePTID(author))
	if err != nil {
		t.Fatalf("author get moment: %v", err)
	}
	if got := reactionCount(authorPost, model.ReactionKind_REACTION_LIKE); got != 2 {
		t.Fatalf("author LIKE count = %d, want 2", got)
	}
}

func reactionCount(post *model.Post, kind model.ReactionKind) int64 {
	if post == nil {
		return 0
	}
	for _, summary := range post.Reactions {
		if summary.Kind == kind {
			return summary.Count
		}
	}
	return 0
}

// TestImagePost_AttachmentsCarryCID asserts the read path returns
// `ImageAttachment.Url == Id == cid` so a desktop client can render the
// `ImageAttachment.Url == Id == cid` so a desktop client can render the
// image with a single field lookup. Pre-P1-closure the converter only
// populated `Id` and clients had to know "Id is also the URL" — that
// implicit contract is now explicit.
func TestImagePost_AttachmentsCarryCID(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	cids := []string{
		"oss://station.local/2026/04/28/img-aaa.png",
		"oss://station.local/2026/04/28/img-bbb.jpg",
	}

	post, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_IMAGE,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Image{
			Image: &model.CreateImagePostRequest{
				Text:     "two photos",
				ImageIds: cids,
			},
		},
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create IMAGE: %v", err)
	}

	got := post.GetImagePost()
	if got == nil {
		t.Fatalf("expected ImagePost content, got %T", post.Content)
	}
	if len(got.Images) != len(cids) {
		t.Fatalf("expected %d images, got %d", len(cids), len(got.Images))
	}
	for i, img := range got.Images {
		if img.Id != cids[i] {
			t.Fatalf("image[%d].Id = %q, want %q", i, img.Id, cids[i])
		}
		if img.Url != cids[i] {
			t.Fatalf("image[%d].Url = %q, want %q (cid mirrored to Url)", i, img.Url, cids[i])
		}
	}
}

func TestVisibilityGate_RepostRejectsUnreadableSource(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	const reposter = uint64(200)

	// Author writes a SELF-only post.
	private, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_SELF},
		Content:  textBody("private musing"),
	}, fixturePTID(author))
	if err != nil {
		t.Fatalf("create SELF: %v", err)
	}

	// Reposter tries to wrap it in a public REPOST envelope. Without
	// the gate, this would succeed and turn "I know id X exists in
	// author's private inventory" into a publicly-attributable post.
	_, err = f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_REPOST,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Repost{
			Repost: &model.CreateRepostRequest{
				OriginalPostId: private.Id,
				Comment:        "look at this",
			},
		},
	}, fixturePTID(reposter))
	if err == nil {
		t.Fatal("repost of unreadable source must be rejected")
	}

	// And the reposter's own public post can be reposted by themselves
	// (sanity: gate doesn't false-positive on legitimate flows).
	pub, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("public statement"),
	}, fixturePTID(reposter))
	if err != nil {
		t.Fatalf("create PUBLIC: %v", err)
	}
	if _, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_REPOST,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Repost{
			Repost: &model.CreateRepostRequest{OriginalPostId: pub.Id, Comment: "self-quote"},
		},
	}, fixturePTID(reposter)); err != nil {
		t.Fatalf("legitimate repost must succeed: %v", err)
	}
}
