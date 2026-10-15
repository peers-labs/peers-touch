package application

import (
	"context"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
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
	if err := infrastructure.MigrateIdentitySchema(gdb); err != nil {
		t.Fatalf("migrate Social relationship authority: %v", err)
	}
	if err := gdb.Exec(`
CREATE TABLE social_relationship_projections (
	owner_ptid text,
	peer_ptid text,
	request_id text,
	accepted_event_id text,
	accepted_event_hash blob,
	accepted_at datetime,
	PRIMARY KEY (owner_ptid, peer_ptid)
)`).Error; err != nil {
		t.Fatalf("migrate relationship projections: %v", err)
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
		"INSERT INTO social_directional_relationships "+
			"(actor_ptid, target_actor_ptid, actor_home_station_peer_id, "+
			"target_home_station_peer_id, blocked, revision, updated_at) "+
			"VALUES (?, ?, '', '', ?, ?, CURRENT_TIMESTAMP)",
		actorPTID,
		peerPTID,
		true,
		1,
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

func TestRelationshipUnfollowRetiresCanonicalFriendship(t *testing.T) {
	f := newRelationshipFixture(t)
	ctx := context.Background()
	const (
		alice = "ptid:v1:actor:peers:p:user-1:fingerprint-1"
		bob   = "ptid:v1:actor:peers:p:user-2:fingerprint-2"
	)
	if err := f.repos.Follows.Follow(ctx, alice, bob); err != nil {
		t.Fatalf("seed Alice follow: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, bob, alice); err != nil {
		t.Fatalf("seed Bob follow: %v", err)
	}
	if err := f.gdb.Exec(
		`INSERT INTO friend_chat_friendships
			(actor_ptid, peer_ptid, status) VALUES (?, ?, 2), (?, ?, 2)`,
		alice,
		bob,
		bob,
		alice,
	).Error; err != nil {
		t.Fatalf("seed friendship rows: %v", err)
	}
	if err := f.gdb.Exec(
		`INSERT INTO social_relationship_projections
			(owner_ptid, peer_ptid, request_id, accepted_event_id,
			 accepted_event_hash, accepted_at)
		 VALUES (?, ?, 'request-1', 'event-1', X'01', CURRENT_TIMESTAMP),
		        (?, ?, 'request-1', 'event-1', X'01', CURRENT_TIMESTAMP)`,
		alice,
		bob,
		bob,
		alice,
	).Error; err != nil {
		t.Fatalf("seed relationship projections: %v", err)
	}

	if err := f.service.Unfollow(ctx, alice, bob); err != nil {
		t.Fatalf("unfollow: %v", err)
	}

	var friendshipCount int64
	if err := f.gdb.Table("friend_chat_friendships").
		Where(
			"(actor_ptid = ? AND peer_ptid = ?) OR "+
				"(actor_ptid = ? AND peer_ptid = ?)",
			alice,
			bob,
			bob,
			alice,
		).
		Count(&friendshipCount).Error; err != nil {
		t.Fatalf("count friendship rows: %v", err)
	}
	var projectionCount int64
	if err := f.gdb.Table("social_relationship_projections").
		Where(
			"(owner_ptid = ? AND peer_ptid = ?) OR "+
				"(owner_ptid = ? AND peer_ptid = ?)",
			alice,
			bob,
			bob,
			alice,
		).
		Count(&projectionCount).Error; err != nil {
		t.Fatalf("count relationship projections: %v", err)
	}
	if friendshipCount != 0 || projectionCount != 0 {
		t.Fatalf(
			"unfollow left active friendship truth: friendships=%d projections=%d",
			friendshipCount,
			projectionCount,
		)
	}
	relationship, err := f.service.GetRelationship(ctx, alice, bob)
	if err != nil {
		t.Fatalf("get relationship: %v", err)
	}
	if relationship.Following {
		t.Fatal("unfollow kept the caller's follow edge")
	}
}

func TestFederatedPrivateInvalidationUnfollowUsesRelationshipTransaction(
	t *testing.T,
) {
	f := newRelationshipFixture(t)
	ctx := context.Background()
	alice := "ptid:v1:actor:peers:p:user-1:fingerprint-1"
	bob := "ptid:v1:actor:peers:p:user-2:fingerprint-2"
	if err := f.repos.Follows.Follow(ctx, alice, bob); err != nil {
		t.Fatal(err)
	}
	revoker := &recordingPrivateRelationshipRevoker{}
	f.service.ConfigurePrivateRevocation(revoker, nil)

	if err := f.service.Unfollow(ctx, alice, bob); err != nil {
		t.Fatal(err)
	}
	if revoker.calls != 1 ||
		revoker.transaction == nil ||
		revoker.localActorPTID != alice ||
		revoker.peerActorPTID != bob ||
		len(revoker.sourceAudienceKinds) != 1 ||
		revoker.sourceAudienceKinds[0] != model.Audience_FRIENDS ||
		len(revoker.suppressedAudienceKinds) != 2 ||
		revoker.reason != privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RELATIONSHIP_REVOKED {
		t.Fatalf("relationship revocation = %+v", revoker)
	}
}

type recordingPrivateRelationshipRevoker struct {
	calls                   int
	transaction             delivery.Transaction
	localActorPTID          string
	peerActorPTID           string
	sourceAudienceKinds     []model.Audience_Kind
	suppressedAudienceKinds []model.Audience_Kind
	reason                  privatecontentpb.PrivateResourceInvalidationReason
}

func (r *recordingPrivateRelationshipRevoker) RevokePrivateRelationship(
	_ context.Context,
	transaction delivery.Transaction,
	localActorPTID string,
	peerActorPTID string,
	sourceAudienceKinds []model.Audience_Kind,
	suppressedAudienceKinds []model.Audience_Kind,
	reason privatecontentpb.PrivateResourceInvalidationReason,
) error {
	r.calls++
	r.transaction = transaction
	r.localActorPTID = localActorPTID
	r.peerActorPTID = peerActorPTID
	r.sourceAudienceKinds = append(
		[]model.Audience_Kind(nil),
		sourceAudienceKinds...,
	)
	r.suppressedAudienceKinds = append(
		[]model.Audience_Kind(nil),
		suppressedAudienceKinds...,
	)
	r.reason = reason
	return nil
}

func TestRelationshipListsHydrateActorProjections(t *testing.T) {
	f := newRelationshipFixture(t)
	ctx := context.Background()
	const (
		alice = "ptid:v1:actor:peers:p:user-1:fingerprint-1"
		bob   = "ptid:v1:actor:peers:p:user-2:fingerprint-2"
	)
	if err := f.gdb.Model(&db.Actor{}).
		Where("ptid = ?", bob).
		Updates(map[string]any{
			"icon":                 "data:image/svg+xml,bob",
			"home_station_domain":  "station-b.example",
			"home_station_peer_id": "station-b-peer",
		}).Error; err != nil {
		t.Fatalf("seed Bob identity projection: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, alice, bob); err != nil {
		t.Fatalf("seed follow alice->bob: %v", err)
	}
	if err := f.repos.Follows.Follow(ctx, bob, alice); err != nil {
		t.Fatalf("seed follow bob->alice: %v", err)
	}

	followers, _, followerTotal, err := f.service.GetFollowers(ctx, alice, "", 20)
	if err != nil {
		t.Fatalf("get followers: %v", err)
	}
	if followerTotal != 1 || len(followers) != 1 {
		t.Fatalf(
			"followers must include hydrated actor projection: total=%d len=%d",
			followerTotal,
			len(followers),
		)
	}
	if followers[0].ActorPtid != bob {
		t.Fatalf("follower actor PTID = %q, want %q", followers[0].ActorPtid, bob)
	}
	if followers[0].AvatarUrl != "data:image/svg+xml,bob" ||
		followers[0].HomeStationDomain != "station-b.example" ||
		followers[0].HomeStationPeerId != "station-b-peer" {
		t.Fatalf("follower identity projection = %+v", followers[0])
	}

	following, _, followingTotal, err := f.service.GetFollowing(ctx, alice, "", 20)
	if err != nil {
		t.Fatalf("get following: %v", err)
	}
	if followingTotal != 1 || len(following) != 1 {
		t.Fatalf(
			"following must include hydrated actor projection: total=%d len=%d",
			followingTotal,
			len(following),
		)
	}
	if following[0].ActorPtid != bob {
		t.Fatalf("following actor PTID = %q, want %q", following[0].ActorPtid, bob)
	}
	if following[0].AvatarUrl != "data:image/svg+xml,bob" ||
		following[0].HomeStationDomain != "station-b.example" ||
		following[0].HomeStationPeerId != "station-b-peer" {
		t.Fatalf("following identity projection = %+v", following[0])
	}
}

func TestFederatedHandleOfCanonicalizesWireProjection(t *testing.T) {
	tests := []struct {
		name  string
		actor *db.Actor
		want  string
	}{
		{name: "nil actor", actor: nil, want: ""},
		{name: "legacy empty handle", actor: &db.Actor{}, want: ""},
		{
			name:  "routing normalized remote handle",
			actor: &db.Actor{FederatedHandle: "bob@station.example"},
			want:  "@bob@station.example",
		},
		{
			name:  "canonical local handle",
			actor: &db.Actor{FederatedHandle: "@bob@station.example"},
			want:  "@bob@station.example",
		},
		{
			name:  "surrounding whitespace",
			actor: &db.Actor{FederatedHandle: " bob@station.example "},
			want:  "@bob@station.example",
		},
		{
			name:  "malformed local-only handle",
			actor: &db.Actor{FederatedHandle: "bob"},
			want:  "",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := federatedHandleOf(test.actor); got != test.want {
				t.Fatalf(
					"federatedHandleOf() = %q, want %q",
					got,
					test.want,
				)
			}
		})
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
