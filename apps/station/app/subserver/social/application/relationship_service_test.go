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
	if err := gdb.AutoMigrate(&db.Actor{}, &db.Follow{}); err != nil {
		t.Fatalf("migrate follows: %v", err)
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
	seedFixtureActors(t, gdb)
	repos := infrastructure.NewRepos(gdb)
	return &relationshipFixture{
		gdb:     gdb,
		repos:   repos,
		service: NewRelationshipService(repos.Follows, repos.Blocks),
	}
}

func (f *relationshipFixture) seedBlock(t *testing.T, actorPTID, peerPTID string) {
	t.Helper()
	if err := f.gdb.Exec(
		"INSERT INTO friend_chat_friendships (actor_ptid, peer_ptid, status) VALUES (?, ?, 3)",
		actorPTID,
		peerPTID,
	).Error; err != nil {
		t.Fatalf("seed block %s->%s: %v", actorPTID, peerPTID, err)
	}
}

func TestRelationshipFollowDeniedWhenBlocked(t *testing.T) {
	f := newRelationshipFixture(t)
	f.seedBlock(t, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "ptid:v1:actor:peers:p:user-2:fingerprint-2")

	if _, err := f.service.Follow(context.Background(), "ptid:v1:actor:peers:p:user-1:fingerprint-1", "ptid:v1:actor:peers:p:user-2:fingerprint-2"); err == nil {
		t.Fatal("expected follow to be denied when pair is blocked")
	}
}

func TestRelationshipStatusSuppressesBlockedEdges(t *testing.T) {
	f := newRelationshipFixture(t)
	ctx := context.Background()
	if err := f.repos.Follows.Follow(ctx, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "ptid:v1:actor:peers:p:user-2:fingerprint-2"); err != nil {
		t.Fatalf("seed follow 1->2: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, "ptid:v1:actor:peers:p:user-2:fingerprint-2", "ptid:v1:actor:peers:p:user-1:fingerprint-1"); err != nil {
		t.Fatalf("seed follow 2->1: %v", err)
	}
	f.seedBlock(t, "ptid:v1:actor:peers:p:user-2:fingerprint-2", "ptid:v1:actor:peers:p:user-1:fingerprint-1")

	relationship, err := f.service.GetRelationship(ctx, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "ptid:v1:actor:peers:p:user-2:fingerprint-2")
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
	if err := f.repos.Follows.Follow(ctx, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "ptid:v1:actor:peers:p:user-2:fingerprint-2"); err != nil {
		t.Fatalf("seed follow 1->2: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, "ptid:v1:actor:peers:p:user-2:fingerprint-2", "ptid:v1:actor:peers:p:user-1:fingerprint-1"); err != nil {
		t.Fatalf("seed follow 2->1: %v", err)
	}
	f.seedBlock(t, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "ptid:v1:actor:peers:p:user-2:fingerprint-2")

	followers, _, _, err := f.service.GetFollowers(ctx, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "", 20)
	if err != nil {
		t.Fatalf("get followers: %v", err)
	}
	if len(followers) != 0 {
		t.Fatalf("blocked follower must be filtered, got %d", len(followers))
	}

	following, _, _, err := f.service.GetFollowing(ctx, "ptid:v1:actor:peers:p:user-1:fingerprint-1", "", 20)
	if err != nil {
		t.Fatalf("get following: %v", err)
	}
	if len(following) != 0 {
		t.Fatalf("blocked following edge must be filtered, got %d", len(following))
	}
}
