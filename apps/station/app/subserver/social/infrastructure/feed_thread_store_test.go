package infrastructure

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

func TestFeedThreadHistorySurvivesLateReaderAndIsBounded(t *testing.T) {
	store, database, bundle := interactionFixture(t)
	ctx := context.Background()
	projector := NewFeedProjector("station-a")
	payload := &model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
		Reaction: &model.FeedReactionMutation{TargetPostRef: "oss://station-a/post/101", ReactionKind: 1}}}
	for n := uint64(1); n <= 40; n++ {
		receipt := makeInteraction(t, bundle, n, model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET, payload)
		if err := store.Transaction(ctx, func(tx *gorm.DB) error {
			_, err := projector.StoreInteraction(ctx, tx, receipt, "station-b", true)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	request := &model.ReadFeedRequest{ActorPtid: "ptid:test:alice", IncludeThread: true}
	page := &model.ReadFeedResponse{}
	if err := store.readThread(ctx, database, request, page); err != nil {
		t.Fatal(err)
	}
	if len(page.ThreadEntries) != 32 || page.ThreadCursor != 32 || !page.ThreadHasMore {
		t.Fatalf("unbounded or lost history: %v", page)
	}
	request.AfterThreadCursor = page.ThreadCursor
	page = &model.ReadFeedResponse{}
	if err := store.readThread(ctx, database, request, page); err != nil {
		t.Fatal(err)
	}
	if len(page.ThreadEntries) != 8 || page.ThreadCursor != 40 || page.ThreadHasMore {
		t.Fatalf("lost tail: %v", page)
	}
	request.AfterThreadCursor = 41
	if err := store.readThread(ctx, database, request, &model.ReadFeedResponse{}); !errors.Is(err, domain.ErrFeedRollback) {
		t.Fatal("rollback accepted", err)
	}
	request.AfterThreadCursor = 0
	if err := database.Model(&FeedInteractionRecord{}).Where("sequence = 1").Update("interaction", []byte{0}).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.readThread(ctx, database, request, &model.ReadFeedResponse{}); err == nil {
		t.Fatal("corrupt historical receipt served")
	}
}

func TestFeedProjectionRollbackDiscardsRealtimeCallbacks(t *testing.T) {
	store, database, bundle, root := feedStoreFixture(t)
	ctx := context.Background()
	called := false
	var rejection error
	err := store.Execute(ctx, func(tx delivery.Transaction) error {
		bound := FeedTransactionContext(ctx, tx)
		_, _, rejection = store.AppendTx(bound, tx.DB(), bundle, "ptid:test:alice", "station-a", root,
			func(ctx context.Context, _ *gorm.DB, _ *model.FeedEvent) error {
				if err := FeedTransactionFromContext(ctx).(delivery.AfterCommitRegistrar).AfterCommit(func(context.Context) error { called = true; return nil }); err != nil {
					return err
				}
				return domain.ErrFeedFork
			}, false)
		if errors.Is(rejection, domain.ErrFeedFork) {
			return nil
		}
		return rejection
	})
	if err != nil || !errors.Is(rejection, domain.ErrFeedFork) || called {
		t.Fatal("rolled-back projection leaked realtime callback", err, rejection, called)
	}
	var count int64
	if err := database.Model(&FeedEventRecord{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("partial append committed", count, err)
	}
}
