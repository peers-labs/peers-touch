package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func privateFollowersFixture(t *testing.T) (*gorm.DB, *FeedLogStore) {
	t.Helper()
	database, err := gorm.Open(sqlite.Open(":memory:"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.AutoMigrate(
		&dbmodel.Actor{}, &dbmodel.Follow{}, &FeedSubscriptionRecord{},
		&socialDirectionalRelationshipModel{},
	); err != nil {
		t.Fatal(err)
	}
	for index, ptid := range []string{"author", "local", "remote", "stranger"} {
		home := "station-a"
		if ptid == "remote" || ptid == "stranger" {
			home = "station-b"
		}
		if err := database.Create(&dbmodel.Actor{
			ID: uint64(index + 1), PTID: ptid, PreferredUsername: ptid,
			Email: ptid + "@example.test", FederatedHandle: ptid + "@" + home,
			HomeStationPeerID: home,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := database.Create(&dbmodel.Follow{
		ID: 1, FollowingID: 1, FollowerID: 2, CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	store, err := NewFeedLogStore(database)
	if err != nil {
		t.Fatal(err)
	}
	return database, store
}

func TestPrivateFollowersSnapshotAndReadsUseHomeBoundSubscription(t *testing.T) {
	for _, testCase := range []struct {
		name              string
		authorStation     string
		subscriberStation string
		enabled           bool
		revision          uint64
		chain             string
		wantRemote        bool
	}{
		{"authenticated remote", "station-a", "station-b", true, 3, socialdomain.PublicFeedChainID, true},
		{"disabled remote", "station-a", "station-b", false, 4, socialdomain.PublicFeedChainID, false},
		{"uninitialized remote", "station-a", "station-b", true, 0, socialdomain.PublicFeedChainID, false},
		{"wrong author Home", "station-c", "station-b", true, 3, socialdomain.PublicFeedChainID, false},
		{"wrong subscriber Home", "station-a", "station-c", true, 3, socialdomain.PublicFeedChainID, false},
		{"nonpublic chain", "station-a", "station-b", true, 3, "other-chain", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			database, _ := privateFollowersFixture(t)
			// A stale remote follow mirror must never override a disabled or
			// invalid subscription at the author Station.
			if err := database.Create(&dbmodel.Follow{
				ID: 2, FollowingID: 1, FollowerID: 3, CreatedAt: time.Now().UTC(),
			}).Error; err != nil {
				t.Fatal(err)
			}
			if err := database.Create(&FeedSubscriptionRecord{
				AuthorPTID: "author", SubscriberPTID: "remote", ChainID: testCase.chain,
				AuthorStation: testCase.authorStation, SubscriberStation: testCase.subscriberStation,
				Enabled: testCase.enabled, Revision: testCase.revision,
			}).Error; err != nil {
				t.Fatal(err)
			}
			snapshot, err := loadFollowersSnapshot(context.Background(), database, "author")
			if err != nil {
				t.Fatal(err)
			}
			want := []string{"local"}
			if testCase.wantRemote {
				want = append(want, "remote")
			}
			if !reflect.DeepEqual(snapshot.RecipientPTIDs, want) {
				t.Fatalf("recipients = %v, want %v", snapshot.RecipientPTIDs, want)
			}
			for _, viewer := range []string{"local", "remote", "stranger"} {
				err := authorizePrivateFollower(database, "author", viewer)
				allowed := viewer == "local" || viewer == "remote" && testCase.wantRemote
				if allowed && err != nil || !allowed && !errors.Is(err, ErrPrivateContentNotFound) {
					t.Fatalf("viewer %s allowed=%v, error=%v", viewer, allowed, err)
				}
			}
		})
	}
}

func TestPrivateFollowersRemoteRevisionBlockAndCustomDeny(t *testing.T) {
	database, store := privateFollowersFixture(t)
	ctx := context.Background()
	set := func(enabled bool, revision uint64) bool {
		t.Helper()
		_, duplicate, err := store.SetSubscriptionTx(ctx, database,
			"author", "remote", "station-a", "station-b", enabled, revision)
		if err != nil {
			t.Fatal(err)
		}
		return duplicate
	}
	snapshot := func() socialdomain.FriendsSnapshot {
		t.Helper()
		result, err := loadFollowersSnapshot(ctx, database, "author")
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	set(true, 1)
	before := snapshot()
	denied, err := loadCustomDenySnapshot(ctx, database, "author",
		[]string{"local"}, actormodel.Audience_FOLLOWERS)
	if err != nil || !reflect.DeepEqual(denied.RecipientPTIDs, []string{"remote"}) {
		t.Fatalf("remote CUSTOM_DENY = %+v, %v", denied, err)
	}
	set(false, 2)
	unfollowed := snapshot()
	if bytes.Equal(before.SourceHeadSHA256, unfollowed.SourceHeadSHA256) ||
		!reflect.DeepEqual(unfollowed.RecipientPTIDs, []string{"local"}) {
		t.Fatal("unfollow did not invalidate the prepared audience")
	}
	if !set(true, 1) || !bytes.Equal(unfollowed.SourceHeadSHA256, snapshot().SourceHeadSHA256) {
		t.Fatal("stale subscription replay restored a revoked follower")
	}
	set(true, 3)
	refollowed := snapshot()
	if bytes.Equal(before.SourceHeadSHA256, refollowed.SourceHeadSHA256) {
		t.Fatal("refollow reused a prior prepared audience commitment")
	}
	if err := database.Create(&socialDirectionalRelationshipModel{
		ActorPTID: "remote", TargetActorPTID: "author", Blocked: true,
		Revision: 1, UpdatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	blocked := snapshot()
	if !reflect.DeepEqual(blocked.RecipientPTIDs, []string{"local"}) ||
		bytes.Equal(refollowed.SourceHeadSHA256, blocked.SourceHeadSHA256) {
		t.Fatal("reverse block did not remove and invalidate the remote audience")
	}
	if err := authorizePrivateCurrentAudience(database,
		dbmodel.SocialPrivateAudienceSnapshot{AudienceKind: "FOLLOWERS"},
		&actormodel.Audience{Kind: actormodel.Audience_FOLLOWERS}, "author", "remote",
	); !errors.Is(err, ErrPrivateContentNotFound) {
		t.Fatalf("blocked remote current read error = %v", err)
	}
}
