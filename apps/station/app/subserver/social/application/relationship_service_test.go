package application

import (
	"context"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type relationshipFixture struct {
	gdb     *gorm.DB
	repos   *infrastructure.Repos
	service *RelationshipService
}

func newRelationshipFixture(t *testing.T) *relationshipFixture {
	t.Helper()
	dsn := fmt.Sprintf("file:relationship_test_%d?mode=memory&cache=shared&_pragma=foreign_keys(1)", fixtureDBSeq.Add(1))
	gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(&db.Follow{}); err != nil {
		t.Fatalf("migrate follows: %v", err)
	}
	if err := gdb.Exec(`
CREATE TABLE friend_chat_friendships (
	id integer primary key autoincrement,
	actor_did text,
	peer_did text,
	status integer,
	created_at datetime,
	updated_at datetime
)`).Error; err != nil {
		t.Fatalf("migrate friendships: %v", err)
	}
	resolver := NewNoopActorResolver()
	repos := infrastructure.NewRepos(gdb, resolver.ResolveID)
	return &relationshipFixture{
		gdb:     gdb,
		repos:   repos,
		service: NewRelationshipService(repos.Follows, repos.Blocks),
	}
}

func (f *relationshipFixture) seedBlock(t *testing.T, actorID, peerID uint64) {
	t.Helper()
	if err := f.gdb.Exec(
		"INSERT INTO friend_chat_friendships (actor_did, peer_did, status) VALUES (?, ?, 3)",
		fmt.Sprintf("%d", actorID),
		fmt.Sprintf("%d", peerID),
	).Error; err != nil {
		t.Fatalf("seed block %d->%d: %v", actorID, peerID, err)
	}
}

func TestRelationshipFollowDeniedWhenBlocked(t *testing.T) {
	f := newRelationshipFixture(t)
	f.seedBlock(t, 1, 2)

	if _, err := f.service.Follow(context.Background(), 1, "2"); err == nil {
		t.Fatal("expected follow to be denied when pair is blocked")
	}
}

func TestRelationshipStatusSuppressesBlockedEdges(t *testing.T) {
	f := newRelationshipFixture(t)
	ctx := context.Background()
	if err := f.repos.Follows.Follow(ctx, 1, 2); err != nil {
		t.Fatalf("seed follow 1->2: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, 2, 1); err != nil {
		t.Fatalf("seed follow 2->1: %v", err)
	}
	f.seedBlock(t, 2, 1)

	relationship, err := f.service.GetRelationship(ctx, 1, "2")
	if err != nil {
		t.Fatalf("get relationship: %v", err)
	}
	if relationship.Following || relationship.FollowedBy {
		t.Fatalf("expected blocked relationship to suppress edges, got following=%v followedBy=%v", relationship.Following, relationship.FollowedBy)
	}
}

func TestRelationshipListsFilterBlockedEdges(t *testing.T) {
	f := newRelationshipFixture(t)
	ctx := context.Background()
	if err := f.repos.Follows.Follow(ctx, 1, 2); err != nil {
		t.Fatalf("seed follow 1->2: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, 2, 1); err != nil {
		t.Fatalf("seed follow 2->1: %v", err)
	}
	f.seedBlock(t, 1, 2)

	followers, _, _, err := f.service.GetFollowers(ctx, 1, "", 20)
	if err != nil {
		t.Fatalf("get followers: %v", err)
	}
	if len(followers) != 0 {
		t.Fatalf("blocked follower must be filtered, got %d", len(followers))
	}

	following, _, _, err := f.service.GetFollowing(ctx, 1, "", 20)
	if err != nil {
		t.Fatalf("get following: %v", err)
	}
	if len(following) != 0 {
		t.Fatalf("blocked following edge must be filtered, got %d", len(following))
	}
}
