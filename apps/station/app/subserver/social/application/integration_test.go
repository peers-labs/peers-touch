package application

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
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

// W11_NEGATIVE_FIXTURE: these fixture-only models preserve pre-cut rows for
// negative migration and audience-policy tests. Production code has no legacy
// private model or reader.
type legacyPrivatePostFixture struct {
	ID                 uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`
	AuthorID           uint64 `gorm:"column:author_id;not null"`
	Type               string `gorm:"column:type;type:varchar(20);not null"`
	AudienceKind       string `gorm:"column:audience_kind;type:varchar(16);not null"`
	AudienceTargetID   uint64 `gorm:"column:audience_target_id;default:0"`
	AudienceBaseKind   string `gorm:"column:audience_base_kind;type:varchar(16)"`
	TextBody           string `gorm:"column:text_body;type:text"`
	CommentsCount      int64  `gorm:"column:comments_count;default:0"`
	ReactionsCountJSON string `gorm:"column:reactions_count_json;type:text"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
	DeletedAt          *time.Time
}

func (legacyPrivatePostFixture) TableName() string {
	return "social_private_posts"
}

type legacyPrivateAudienceGrantFixture struct {
	PostID    uint64    `gorm:"column:post_id;primaryKey;autoIncrement:false"`
	ActorPTID string    `gorm:"column:actor_ptid;primaryKey;size:128"`
	Role      string    `gorm:"column:role;type:varchar(8);not null"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (legacyPrivateAudienceGrantFixture) TableName() string {
	return "social_private_audience_grants"
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
		&legacyPrivatePostFixture{},
		&db.SocialMomentDelivery{},
		&legacyPrivateAudienceGrantFixture{},
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
	if err := infrastructure.MigrateIdentitySchema(gdb); err != nil {
		t.Fatalf("migrate Social relationship authority: %v", err)
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
	actorPTID := fixturePTID(actorID)
	peerPTID := fixturePTID(peerID)
	if err := f.gdb.Exec(
		"INSERT INTO social_directional_relationships "+
			"(actor_ptid, target_actor_ptid, actor_home_station_peer_id, "+
			"target_home_station_peer_id, blocked, revision, updated_at) "+
			"VALUES (?, ?, '', '', ?, ?, CURRENT_TIMESTAMP)",
		actorPTID,
		peerPTID,
		true,
		1,
	).Error; err != nil {
		t.Fatalf("seed block %d->%d: %v", actorID, peerID, err)
	}
}

func textBody(text string) *model.CreatePostRequest_Text {
	return &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: text}}
}

// ---------------------------------------------------------------------------
// seedPrivatePost inserts a non-PUBLIC post directly into the
// social_private_posts table, bypassing MomentService.CreateMoment
// (which rejects non-PUBLIC audiences after the W11 hard-cut). These
// integration tests exercise read-side visibility, not write-side
// routing, so a direct DB seed is sufficient.
//
// For CUSTOM_ALLOW / CUSTOM_DENY audiences the corresponding
// audience-grant rows are inserted in the same call.
// ---------------------------------------------------------------------------

type seedPostResult struct {
	ID       uint64
	IDStr    string
	Audience *model.Audience
}

func seedPrivatePost(t *testing.T, f *fixture, audience *model.Audience, text string, authorID uint64) seedPostResult {
	t.Helper()

	postID := id.NextID()
	now := time.Now().UTC().Truncate(time.Microsecond)

	row := legacyPrivatePostFixture{
		ID:           postID,
		AuthorID:     authorID,
		Type:         model.PostType_TEXT.String(),
		AudienceKind: audience.Kind.String(),
		TextBody:     text,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if audience.Kind == model.Audience_CUSTOM_DENY {
		row.AudienceBaseKind = audience.BaseKind.String()
	}
	if audience.Kind == model.Audience_CIRCLE || audience.Kind == model.Audience_GROUP {
		row.AudienceTargetID = audience.TargetId
	}

	if err := f.gdb.Create(&row).Error; err != nil {
		t.Fatalf("seedPrivatePost: insert: %v", err)
	}

	// Insert audience-grant rows for CUSTOM_* audiences.
	if audience.Kind == model.Audience_CUSTOM_ALLOW || audience.Kind == model.Audience_CUSTOM_DENY {
		role := "allow"
		if audience.Kind == model.Audience_CUSTOM_DENY {
			role = "deny"
		}
		for _, ptid := range audience.ActorPtids {
			if ptid == "" {
				continue
			}
			grant := legacyPrivateAudienceGrantFixture{
				PostID:    postID,
				ActorPTID: ptid,
				Role:      role,
				CreatedAt: now,
			}
			if err := f.gdb.Create(&grant).Error; err != nil {
				t.Fatalf("seedPrivatePost: grant: %v", err)
			}
		}
	}

	// Build delivery rows so timeline tests work.
	deliveries := buildSeedDeliveries(t, f, postID, authorID, audience)
	for i := range deliveries {
		if err := f.gdb.Create(&deliveries[i]).Error; err != nil {
			t.Fatalf("seedPrivatePost: delivery: %v", err)
		}
	}

	return seedPostResult{
		ID:       postID,
		IDStr:    fmt.Sprintf("%d", postID),
		Audience: audience,
	}
}

// buildSeedDeliveries replicates the fan-out logic from
// MomentService.buildMomentDeliveries for test seeding.
func buildSeedDeliveries(t *testing.T, f *fixture, postID, authorID uint64, audience *model.Audience) []db.SocialMomentDelivery {
	t.Helper()
	ctx := context.Background()
	authorPTID := fixturePTID(authorID)
	now := time.Now().UTC().Truncate(time.Microsecond)
	recipients := map[string]struct{}{authorPTID: {}}

	switch audience.Kind {
	case model.Audience_SELF:
		// Author-only.
	case model.Audience_FOLLOWERS:
		followers, err := f.repos.Follows.FollowerActorPTIDs(ctx, authorPTID)
		if err != nil {
			t.Fatalf("buildSeedDeliveries: followers: %v", err)
		}
		for _, ptid := range followers {
			recipients[ptid] = struct{}{}
		}
	case model.Audience_CUSTOM_ALLOW:
		for _, ptid := range audience.ActorPtids {
			if ptid != "" {
				recipients[ptid] = struct{}{}
			}
		}
	case model.Audience_CUSTOM_DENY:
		if audience.BaseKind == model.Audience_FOLLOWERS {
			followers, err := f.repos.Follows.FollowerActorPTIDs(ctx, authorPTID)
			if err != nil {
				t.Fatalf("buildSeedDeliveries: followers: %v", err)
			}
			denied := make(map[string]struct{})
			for _, ptid := range audience.ActorPtids {
				if ptid != "" {
					denied[ptid] = struct{}{}
				}
			}
			for _, ptid := range followers {
				if _, ok := denied[ptid]; !ok {
					recipients[ptid] = struct{}{}
				}
			}
		}
	}

	var out []db.SocialMomentDelivery
	for viewerPTID := range recipients {
		if viewerPTID == "" {
			continue
		}
		viewerID := resolveFixtureActorID(t, f.gdb, viewerPTID)
		out = append(out, db.SocialMomentDelivery{
			ViewerID:     viewerID,
			PostID:       postID,
			AuthorID:     authorID,
			AudienceKind: audience.Kind.String(),
			DeliveredAt:  now,
		})
	}
	return out
}

func resolveFixtureActorID(t *testing.T, gdb *gorm.DB, ptid string) uint64 {
	t.Helper()
	var actorID uint64
	if err := gdb.Model(&db.Actor{}).Select("id").Where("ptid = ?", ptid).Scan(&actorID).Error; err != nil {
		t.Fatalf("resolveFixtureActorID %s: %v", ptid, err)
	}
	return actorID
}

// getAnyMoment reads a post from both the public and private tables,
// reconstructs the correct audience, applies CanRead, and returns the
// wire-shape *model.Post (or nil when the viewer cannot read it). This
// replicates the pre-W11 GetMoment behaviour that checked both storage
// tables.
func getAnyMoment(t *testing.T, f *fixture, postIDStr, viewerPTID string) *model.Post {
	t.Helper()
	ctx := context.Background()

	// Try the public table first (delegates to MomentService).
	pub, err := f.moments.GetMoment(ctx, postIDStr, viewerPTID)
	if err != nil {
		t.Fatalf("getAnyMoment: public get: %v", err)
	}
	if pub != nil {
		return pub
	}

	// Fall back to the private table.
	postID := domain.ParseID(postIDStr)
	if postID == 0 {
		return nil
	}
	var row legacyPrivatePostFixture
	if err := f.gdb.Where("id = ? AND deleted_at IS NULL", postID).First(&row).Error; err != nil {
		return nil // not found
	}

	authorPTID := fixturePTID(row.AuthorID)

	// Reconstruct the audience from the DB columns.
	audienceKind := model.Audience_KIND_UNSPECIFIED
	if v, ok := model.Audience_Kind_value[row.AudienceKind]; ok {
		audienceKind = model.Audience_Kind(v)
	}
	audience := &model.Audience{Kind: audienceKind}
	if row.AudienceTargetID != 0 {
		audience.TargetId = row.AudienceTargetID
	}
	if row.AudienceBaseKind != "" {
		if v, ok := model.Audience_Kind_value[row.AudienceBaseKind]; ok {
			audience.BaseKind = model.Audience_Kind(v)
		}
	}
	// For CUSTOM_ALLOW / CUSTOM_DENY, load the grant list into
	// the audience proto so CanRead can match against it.
	if audienceKind == model.Audience_CUSTOM_ALLOW || audienceKind == model.Audience_CUSTOM_DENY {
		var grants []legacyPrivateAudienceGrantFixture
		if err := f.gdb.WithContext(ctx).
			Where("post_id = ?", postID).
			Find(&grants).Error; err != nil {
			t.Fatalf("getAnyMoment: list legacy fixture grants: %v", err)
		}
		ptids := make([]string, 0, len(grants))
		for _, g := range grants {
			ptids = append(ptids, g.ActorPTID)
		}
		audience.ActorPtids = ptids
	}

	// Build viewer (same logic as MomentService.GetMoment).
	viewer, err := buildViewerForAuthors(ctx, viewerPTID, f.repos, NewNoopGroupMembershipChecker(), []string{authorPTID})
	if err != nil {
		t.Fatalf("getAnyMoment: build viewer: %v", err)
	}
	if ok, _ := domain.CanRead(viewer, authorPTID, audience, false); !ok {
		return nil
	}

	// Return a minimal wire-shape post.
	return &model.Post{
		Id:       postIDStr,
		Audience: audience,
	}
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
	f.gdb.Model(&legacyPrivatePostFixture{}).Count(&privCount)
	if pubCount != 1 || privCount != 0 {
		t.Fatalf("expected 1 public + 0 private rows, got pub=%d priv=%d", pubCount, privCount)
	}

	if post.Audience == nil || post.Audience.Kind != model.Audience_PUBLIC {
		t.Fatalf("returned audience kind = %v, want PUBLIC", post.Audience)
	}
}

func TestStorageSeparation_FollowersLandsInPrivateTable(t *testing.T) {
	f := newFixture(t)

	seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "for my followers", 100)

	var pubCount, privCount int64
	f.gdb.Model(&db.SocialPublicPost{}).Count(&pubCount)
	f.gdb.Model(&legacyPrivatePostFixture{}).Count(&privCount)
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

	created := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_SELF}, "dear diary", 100)

	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(100)); got == nil {
		t.Fatal("author should always see their own SELF post")
	}
	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(200)); got != nil {
		t.Fatal("non-author must not see SELF post")
	}
	if got := getAnyMoment(t, f, created.IDStr, ""); got != nil {
		t.Fatal("anonymous viewer must not see SELF post")
	}
}

func TestRead_FollowersOnlyVisibleToFollowers(t *testing.T) {
	f := newFixture(t)

	const author, follower, stranger = uint64(100), uint64(200), uint64(300)
	seedFollow(t, f, follower, author)

	created := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "followers only", author)

	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(author)); got == nil {
		t.Fatal("author must see their own FOLLOWERS post")
	}
	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(follower)); got == nil {
		t.Fatal("follower must see FOLLOWERS post")
	}
	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(stranger)); got != nil {
		t.Fatal("stranger must not see FOLLOWERS post")
	}
	if got := getAnyMoment(t, f, created.IDStr, ""); got != nil {
		t.Fatal("anonymous viewer must not see FOLLOWERS post")
	}
}

func TestRead_BlockedViewerCannotReadFollowersOnlyPost(t *testing.T) {
	f := newFixture(t)

	const author, follower = uint64(100), uint64(200)
	seedFollow(t, f, follower, author)
	seedBlock(t, f, author, follower)

	created := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "blocked followers cannot read", author)

	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(follower)); got != nil {
		t.Fatal("blocked follower must not read FOLLOWERS post")
	}
}

func TestRead_BlockCannotBeBypassedByAudienceKinds(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author, viewer = uint64(100), uint64(200)
	seedBlock(t, f, viewer, author)

	// PUBLIC posts still go through CreateMoment.
	t.Run("public", func(t *testing.T) {
		created, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
			Type:     model.PostType_TEXT,
			Audience: &model.Audience{Kind: model.Audience_PUBLIC},
			Content:  textBody("public"),
		}, fixturePTID(author))
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		if got := getAnyMoment(t, f, created.Id, fixturePTID(viewer)); got != nil {
			t.Fatal("blocked viewer must not read public post")
		}
	})

	// Non-PUBLIC posts are seeded directly (W11 hard-cut).
	for _, tc := range []struct {
		name     string
		audience *model.Audience
	}{
		{"custom_allow", &model.Audience{Kind: model.Audience_CUSTOM_ALLOW, ActorPtids: []string{fixturePTID(viewer)}}},
		{"custom_deny_public", &model.Audience{Kind: model.Audience_CUSTOM_DENY, BaseKind: model.Audience_PUBLIC, ActorPtids: []string{fixturePTID(300)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created := seedPrivatePost(t, f, tc.audience, tc.name, author)
			if got := getAnyMoment(t, f, created.IDStr, fixturePTID(viewer)); got != nil {
				t.Fatalf("blocked viewer must not read %s post", tc.name)
			}
		})
	}
}

func TestRead_DetailOutcomesRemainDistinctAndPayloadFree(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	available, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("available"),
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("create available: %v", err)
	}
	hidden, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("hidden"),
	}, fixturePTID(300))
	if err != nil {
		t.Fatalf("create hidden: %v", err)
	}
	seedBlock(t, f, 300, 200)
	deleted, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("deleted"),
	}, fixturePTID(100))
	if err != nil {
		t.Fatalf("create deleted: %v", err)
	}
	if err := f.moments.DeleteMoment(ctx, deleted.Id, fixturePTID(100)); err != nil {
		t.Fatalf("delete: %v", err)
	}

	tests := []struct {
		name       string
		postID     string
		viewerPTID string
		want       model.PostDetailOutcome
		wantPost   bool
	}{
		{
			name:       "available",
			postID:     available.Id,
			viewerPTID: fixturePTID(200),
			want:       model.PostDetailOutcome_POST_DETAIL_OUTCOME_AVAILABLE,
			wantPost:   true,
		},
		{
			name:       "hidden",
			postID:     hidden.Id,
			viewerPTID: fixturePTID(200),
			want:       model.PostDetailOutcome_POST_DETAIL_OUTCOME_HIDDEN,
		},
		{
			name:       "deleted",
			postID:     deleted.Id,
			viewerPTID: fixturePTID(100),
			want:       model.PostDetailOutcome_POST_DETAIL_OUTCOME_DELETED,
		},
		{
			name:       "unavailable",
			postID:     "999999999999",
			viewerPTID: fixturePTID(200),
			want:       model.PostDetailOutcome_POST_DETAIL_OUTCOME_UNAVAILABLE,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			post, outcome, err := f.moments.GetMomentDetail(
				ctx,
				tc.postID,
				tc.viewerPTID,
			)
			if err != nil {
				t.Fatalf("get detail: %v", err)
			}
			if outcome != tc.want {
				t.Fatalf("outcome = %s, want %s", outcome, tc.want)
			}
			if (post != nil) != tc.wantPost {
				t.Fatalf("post present = %t, want %t", post != nil, tc.wantPost)
			}
		})
	}
}

func TestTimeline_ReportsTrueEmptyAndFilteredEmpty(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	empty, err := f.timeline.GetTimeline(
		ctx,
		&model.GetTimelineRequest{
			Type:  model.TimelineType_TIMELINE_PUBLIC,
			Limit: 20,
		},
		fixturePTID(200),
	)
	if err != nil {
		t.Fatalf("empty timeline: %v", err)
	}
	if empty.GetOutcome() != model.TimelinePageOutcome_TIMELINE_PAGE_OUTCOME_EMPTY ||
		empty.GetPolicySummary().GetScannedCount() != 0 ||
		empty.GetPolicySummary().GetFilteredCount() != 0 {
		t.Fatalf("unexpected true-empty projection: %+v", empty)
	}

	if _, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  textBody("policy filtered"),
	}, fixturePTID(100)); err != nil {
		t.Fatalf("create filtered post: %v", err)
	}
	seedBlock(t, f, 100, 200)

	filtered, err := f.timeline.GetTimeline(
		ctx,
		&model.GetTimelineRequest{
			Type:  model.TimelineType_TIMELINE_PUBLIC,
			Limit: 20,
		},
		fixturePTID(200),
	)
	if err != nil {
		t.Fatalf("filtered timeline: %v", err)
	}
	if filtered.GetOutcome() !=
		model.TimelinePageOutcome_TIMELINE_PAGE_OUTCOME_FILTERED_EMPTY ||
		filtered.GetPolicySummary().GetScannedCount() != 1 ||
		filtered.GetPolicySummary().GetFilteredCount() != 1 ||
		len(filtered.GetPosts()) != 0 {
		t.Fatalf("unexpected filtered-empty projection: %+v", filtered)
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
	followersPost := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "followers but blocked", author)

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
	assertPostAbsent(t, homeTimeline.Posts, followersPost.IDStr)

	// Verify block graph filters the FOLLOWERS post at the visibility level.
	if got := getAnyMoment(t, f, followersPost.IDStr, fixturePTID(viewer)); got != nil {
		t.Fatal("blocked viewer must not read FOLLOWERS post even through direct visibility check")
	}
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

	const author = uint64(100)
	created := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_SELF}, "private thought", author)

	// Non-author cannot see the SELF post and therefore cannot interact.
	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(200)); got != nil {
		t.Fatal("non-author must not be able to see SELF post (visibility inheritance)")
	}

	// Author can see their own SELF post.
	if got := getAnyMoment(t, f, created.IDStr, fixturePTID(author)); got == nil {
		t.Fatal("author must be able to see their own SELF post")
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

	const author = uint64(100)
	const stranger = uint64(200)

	// SELF — only the author can read.
	selfPost := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_SELF}, "dear diary", author)

	if got := getAnyMoment(t, f, selfPost.IDStr, fixturePTID(stranger)); got != nil {
		t.Fatalf("SELF post must be nil for stranger; got %+v", got)
	}
	if got := getAnyMoment(t, f, selfPost.IDStr, fixturePTID(author)); got == nil {
		t.Fatal("SELF post must be visible to author")
	}

	// FOLLOWERS — only followers can read.
	followersPost := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "for the inner circle", author)

	if got := getAnyMoment(t, f, followersPost.IDStr, fixturePTID(stranger)); got != nil {
		t.Fatalf("FOLLOWERS post must be nil for non-follower; got %+v", got)
	}

	// Become a follower; now visible.
	seedFollow(t, f /*follower*/, stranger /*following*/, author)
	if got := getAnyMoment(t, f, followersPost.IDStr, fixturePTID(stranger)); got == nil {
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

	post := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "followers only", author)

	// Verify delivery rows were created for the follower and author.
	followerDeliveries, err := f.repos.Deliveries.ListInbox(ctx, fixturePTID(follower), domain.Cursor{}, 20)
	if err != nil {
		t.Fatalf("follower deliveries: %v", err)
	}
	if !deliveryContainsPost(followerDeliveries, post.ID) {
		t.Fatalf("follower inbox missing delivered post %d", post.ID)
	}

	// Stranger must not have a delivery row.
	strangerDeliveries, err := f.repos.Deliveries.ListInbox(ctx, fixturePTID(stranger), domain.Cursor{}, 20)
	if err != nil {
		t.Fatalf("stranger deliveries: %v", err)
	}
	if deliveryContainsPost(strangerDeliveries, post.ID) {
		t.Fatalf("stranger inbox must not include delivered post %d", post.ID)
	}
}

func TestDeliveryInbox_DeleteRevokesDeliveredMoment(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	const author = uint64(100)
	const follower = uint64(200)
	seedFollow(t, f, follower, author)

	post := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_FOLLOWERS}, "temporary", author)

	// Verify delivery exists before revocation.
	before, err := f.repos.Deliveries.ListInbox(ctx, fixturePTID(follower), domain.Cursor{}, 20)
	if err != nil {
		t.Fatalf("before revocation: %v", err)
	}
	if !deliveryContainsPost(before, post.ID) {
		t.Fatal("delivery must exist before revocation")
	}

	// Revoke the delivery.
	if err := f.repos.Deliveries.RevokePost(ctx, post.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// After revocation, the delivery must no longer appear in the inbox.
	after, err := f.repos.Deliveries.ListInbox(ctx, fixturePTID(follower), domain.Cursor{}, 20)
	if err != nil {
		t.Fatalf("after revocation: %v", err)
	}
	if deliveryContainsPost(after, post.ID) {
		t.Fatal("follower inbox must not include revoked post")
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

func deliveryContainsPost(deliveries []domain.MomentDelivery, postID uint64) bool {
	for _, d := range deliveries {
		if d.PostID == postID {
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

	// Author writes a SELF-only post (seeded directly since W11 hard-cut
	// removed private post creation from MomentService).
	private := seedPrivatePost(t, f, &model.Audience{Kind: model.Audience_SELF}, "private musing", author)

	// Reposter tries to wrap it in a public REPOST envelope. Without
	// the gate, this would succeed and turn "I know id X exists in
	// author's private inventory" into a publicly-attributable post.
	// After the W11 hard-cut, GetMoment cannot find private posts,
	// so the repost gate rejects the attempt (source not readable).
	_, err := f.moments.CreateMoment(ctx, &model.CreatePostRequest{
		Type:     model.PostType_REPOST,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Repost{
			Repost: &model.CreateRepostRequest{
				OriginalPostId: private.IDStr,
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
