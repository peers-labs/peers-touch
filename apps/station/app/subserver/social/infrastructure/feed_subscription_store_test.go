package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

func TestFeedSubscriptionRevisionAndNotificationCAS(t *testing.T) {
	store, database, _, _ := feedStoreFixture(t)
	ctx := context.Background()
	var selected FeedSubscriptionRecord
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		row, duplicate, err := store.SetSubscriptionTx(ctx, tx, "author", "viewer", "station-a", "station-b", true, 2)
		if err != nil || duplicate {
			t.Fatal(row, duplicate, err)
		}
		selected = *row
		if _, duplicate, err := store.SetSubscriptionTx(ctx, tx, "author", "viewer", "station-a", "station-b", false, 1); err != nil || !duplicate {
			t.Fatal(duplicate, err)
		}
		if _, _, err := store.SetSubscriptionTx(ctx, tx, "author", "viewer", "station-a", "station-b", false, 2); !errors.Is(err, domain.ErrFeedInvalid) {
			t.Fatal(err)
		}
		return store.MarkFeedDirty(ctx, tx, &model.FeedHead{ActorPtid: "author", ChainId: domain.PublicFeedChainID, EventHash: make([]byte, 32)}, "station-a", "station-b")
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishSync(ctx, selected, true, false); err != nil {
		t.Fatal(err)
	}
	var row FeedSubscriptionRecord
	if err := database.Take(&row).Error; err != nil || !row.Dirty || row.DirtyRevision <= selected.DirtyRevision {
		t.Fatalf("stale pull completion cleared a newer notification: %+v %v", row, err)
	}
	if err := store.AuthorizeSubscription(ctx, database, "author", "viewer", "station-c"); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatal(err)
	}
	if _, _, err := store.SetSubscriptionTx(ctx, database, "author", "viewer", "station-a", "station-b", false, 3); err != nil {
		t.Fatal(err)
	}
	if err := store.AuthorizeSubscription(ctx, database, "author", "viewer", "station-b"); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatal(err)
	}
}

func TestFeedFanoutBoundedPagesAndRollback(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	ctx := context.Background()
	if err := store.Transaction(ctx, func(tx *gorm.DB) error {
		_, _, err := store.AppendTx(ctx, tx, bundle, "ptid:test:alice", "station-a", root,
			func(context.Context, *gorm.DB, *model.FeedEvent) error { return nil }, true)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 65; n++ {
		if _, _, err := store.SetSubscriptionTx(ctx, database, "ptid:test:alice", fmt.Sprintf("viewer-%d", n),
			"station-a", fmt.Sprintf("station-%03d", n), true, 1); err != nil {
			t.Fatal(err)
		}
	}
	injected := errors.New("outbox unavailable")
	calls := 0
	if _, err := store.FanoutOne(ctx, "station-a", func(context.Context, delivery.Transaction, string, *model.FeedNotification) error {
		calls++
		if calls == 2 {
			return injected
		}
		return nil
	}); !errors.Is(err, injected) {
		t.Fatal(err)
	}
	var intent FeedFanoutRecord
	if err := database.Take(&intent).Error; err != nil || intent.AfterStation != "" || intent.Completed {
		t.Fatal(intent, err)
	}
	if !intent.NextAttemptAt.After(time.Now()) {
		t.Fatal("failed fanout did not yield to later work")
	}
	if err := database.Model(&intent).Update("next_attempt_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, want := range []int{32, 32, 1} {
		calls = 0
		if _, err := store.FanoutOne(ctx, "station-a", func(_ context.Context, _ delivery.Transaction, target string, _ *model.FeedNotification) error {
			if seen[target] {
				t.Fatal("duplicate target", target)
			}
			seen[target] = true
			calls++
			return nil
		}); err != nil || calls != want {
			t.Fatal(calls, want, err)
		}
	}
	if err := database.Take(&intent).Error; err != nil || !intent.Completed || len(seen) != 65 {
		t.Fatal(intent, err)
	}
	rows, err := store.PendingSync(ctx, "station-000", time.Now().Add(time.Second))
	if err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
}

func TestFeedGraphReconciliationCoversFollowRemovalOutsideCallback(t *testing.T) {
	store, database, _, _ := feedStoreFixture(t)
	ctx := context.Background()
	if err := database.AutoMigrate(&dbmodel.Actor{}, &dbmodel.Follow{}); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []dbmodel.Actor{
		{ID: 1, PTID: "viewer", Email: "viewer@example.test", PreferredUsername: "viewer", FederatedHandle: "viewer@station-b", HomeStationPeerID: "station-b"},
		{ID: 2, PTID: "author", Email: "author@example.test", PreferredUsername: "author", FederatedHandle: "author@station-a", HomeStationPeerID: "station-a"},
	} {
		if err := database.Create(&actor).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := database.Create(&dbmodel.Follow{ID: 1, FollowerID: 1, FollowingID: 2}).Error; err != nil {
		t.Fatal(err)
	}
	changes, err := store.PendingGraphChanges(ctx, "station-b")
	if err != nil || len(changes) != 1 || !changes[0].Enabled || changes[0].AuthorPTID != "author" || changes[0].SubscriberPTID != "viewer" {
		t.Fatal(changes, err)
	}
	if _, _, err := store.SetSubscriptionTx(ctx, database, "author", "viewer", "station-a", "station-b", true, 0); err != nil {
		t.Fatal(err)
	}
	if changes, err := store.PendingGraphChanges(ctx, "station-b"); err != nil || len(changes) != 0 {
		t.Fatal(changes, err)
	}
	if err := database.Where("id = ?", 1).Delete(&dbmodel.Follow{}).Error; err != nil {
		t.Fatal(err)
	}
	changes, err = store.PendingGraphChanges(ctx, "station-b")
	if err != nil || len(changes) != 1 || changes[0].Enabled {
		t.Fatal(changes, err)
	}
}
