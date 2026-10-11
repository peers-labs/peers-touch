package events

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestDurableStoreAllocatesPerActorSequenceAndPersistsTarget(t *testing.T) {
	store := newTestDurableStore(t)

	aliceOne, err := store.Persist(
		"alice",
		"alice-phone",
		msg("alice-one"),
	)
	if err != nil {
		t.Fatal(err)
	}
	bobOne, err := store.Persist("bob", "", msg("bob-one"))
	if err != nil {
		t.Fatal(err)
	}
	aliceTwo, err := store.Persist("alice", "", msg("alice-two"))
	if err != nil {
		t.Fatal(err)
	}

	if aliceOne.Sequence != 1 || aliceTwo.Sequence != 2 ||
		bobOne.Sequence != 1 {
		t.Fatalf(
			"actor sequences alice=%d,%d bob=%d, want 1,2 and 1",
			aliceOne.Sequence,
			aliceTwo.Sequence,
			bobOne.Sequence,
		)
	}
	if aliceOne.Event.GetEventId() != durableEventID(1) ||
		aliceTwo.Event.GetEventId() != durableEventID(2) {
		t.Fatalf(
			"durable event ids = %q,%q",
			aliceOne.Event.GetEventId(),
			aliceTwo.Event.GetEventId(),
		)
	}
	replayed, err := store.ReplayRange("alice", 0, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed) != 2 ||
		replayed[0].TargetDeviceID != "alice-phone" ||
		replayed[1].TargetDeviceID != "" {
		t.Fatalf("durable replay metadata = %+v", replayed)
	}
}

func TestPublishToDeviceInTransactionCommitsTargetAndExcludesRollback(
	t *testing.T,
) {
	store := newTestDurableStore(t).(*gormEventStore)
	bus := newTestBus(t, WithDurableStore(store))
	defer bus.Close()

	ctx := context.Background()
	target, cancelTarget, err := bus.Subscribe(
		ctx,
		"alice",
		"alice-phone",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelTarget()
	sibling, cancelSibling, err := bus.Subscribe(
		ctx,
		"alice",
		"alice-desktop",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelSibling()

	var committed *stagedEventTransaction
	if err := store.db.Transaction(func(transaction *gorm.DB) error {
		committed = &stagedEventTransaction{db: transaction}
		_, err := bus.PublishToDeviceInTransaction(
			ctx,
			committed,
			"alice",
			"alice-phone",
			msg("committed"),
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := committed.runAfterCommit(ctx); err != nil {
		t.Fatal(err)
	}
	delivered := drainN(t, target, 1, 100*time.Millisecond)
	if len(delivered) != 1 ||
		delivered[0].GetMessage().GetUlid() != "committed" {
		t.Fatalf("target delivery = %#v", delivered)
	}
	assertNoEventWithin(t, sibling, 20*time.Millisecond)

	rollback := errors.New("rollback")
	var rolledBack *stagedEventTransaction
	err = store.db.Transaction(func(transaction *gorm.DB) error {
		rolledBack = &stagedEventTransaction{db: transaction}
		if _, err := bus.PublishToDeviceInTransaction(
			ctx,
			rolledBack,
			"bob",
			"bob-phone",
			msg("rolled-back"),
		); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("rollback error = %v", err)
	}
	if head, ok, err := store.Head("bob"); err != nil || ok {
		t.Fatalf("rolled-back actor head = %+v ok=%v err=%v", head, ok, err)
	}
	next, err := store.Persist("bob", "", msg("after-rollback"))
	if err != nil {
		t.Fatal(err)
	}
	if next.Sequence != 1 {
		t.Fatalf("post-rollback sequence = %d, want 1", next.Sequence)
	}
}

func TestTwoNodeWakeDeliversOrderedDeviceFilteredEvents(t *testing.T) {
	store := newTestDurableStore(t)
	wakes := newTestWakeChannel()
	publisher := newTestBus(
		t,
		WithDurableStore(store),
		withWakeEmitter(wakes),
	)
	subscriber := newTestBus(
		t,
		WithDurableStore(store),
		withWakeReceiver(wakes),
		withReconcileInterval(time.Hour),
	)
	defer publisher.Close()
	defer subscriber.Close()
	if err := subscriber.Start(context.Background()); err != nil {
		t.Fatal(err)
	}

	target, cancelTarget, err := subscriber.Subscribe(
		context.Background(),
		"alice",
		"alice-phone",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelTarget()
	sibling, cancelSibling, err := subscriber.Subscribe(
		context.Background(),
		"alice",
		"alice-desktop",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancelSibling()

	targetID, err := publisher.PublishToDevice(
		"alice",
		"alice-phone",
		msg("device-only"),
	)
	if err != nil {
		t.Fatal(err)
	}
	targetOnly := drainN(t, target, 1, 250*time.Millisecond)
	if len(targetOnly) != 1 ||
		targetOnly[0].GetMessage().GetUlid() != "device-only" {
		t.Fatalf("target-only events = %#v", targetOnly)
	}
	assertNoEventWithin(t, sibling, 20*time.Millisecond)
	deadline := time.Now().Add(250 * time.Millisecond)
	for sibling.DurableFloorEventID() != targetID &&
		time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if sibling.DurableFloorEventID() != targetID {
		t.Fatalf(
			"sibling durable floor = %q, want filtered target %q",
			sibling.DurableFloorEventID(),
			targetID,
		)
	}
	if _, err := publisher.Publish("alice", msg("broadcast")); err != nil {
		t.Fatal(err)
	}

	targetEvents := append(
		targetOnly,
		drainN(t, target, 1, 250*time.Millisecond)...,
	)
	if len(targetEvents) != 2 ||
		targetEvents[1].GetMessage().GetUlid() != "broadcast" {
		t.Fatalf("target events = %#v", targetEvents)
	}
	siblingEvents := drainN(t, sibling, 1, 250*time.Millisecond)
	if len(siblingEvents) != 1 ||
		siblingEvents[0].GetMessage().GetUlid() != "broadcast" {
		t.Fatalf("sibling events = %#v", siblingEvents)
	}
}

func TestMissedWakeIsRepairedByBoundedReconciliation(t *testing.T) {
	store := newTestDurableStore(t)
	publisher := newTestBus(t, WithDurableStore(store))
	subscriber := newTestBus(
		t,
		WithDurableStore(store),
		withReconcileInterval(5*time.Millisecond),
	)
	defer publisher.Close()
	defer subscriber.Close()
	if err := subscriber.Start(context.Background()); err != nil {
		t.Fatal(err)
	}

	subscription, cancel, err := subscriber.Subscribe(
		context.Background(),
		"alice",
		"alice-phone",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if _, err := publisher.Publish("alice", msg("reconciled")); err != nil {
		t.Fatal(err)
	}
	delivered := drainN(t, subscription, 1, 250*time.Millisecond)
	if len(delivered) != 1 ||
		delivered[0].GetMessage().GetUlid() != "reconciled" {
		t.Fatalf("missed-wake reconciliation = %#v", delivered)
	}
}

func TestDurableRetentionGapEmitsHeadBoundResync(t *testing.T) {
	store := newTestDurableStore(t).(*gormEventStore)
	bus := newTestBus(t, WithDurableStore(store))
	defer bus.Close()

	cursor, err := bus.Publish("alice", msg("cursor"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Publish("alice", msg("next")); err != nil {
		t.Fatal(err)
	}
	headID, err := bus.Publish("alice", msg("head"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.db.
		Where("actor_ptid = ? AND event_id = ?", "alice", cursor).
		Delete(&realtimeEventModel{}).Error; err != nil {
		t.Fatal(err)
	}

	subscription, cancel, err := bus.Subscribe(
		context.Background(),
		"alice",
		"alice-phone",
		cursor,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	delivered := drainN(t, subscription, 1, 100*time.Millisecond)
	if len(delivered) != 1 || delivered[0].GetResync() == nil ||
		delivered[0].GetEventId() != headID ||
		delivered[0].GetResync().GetNewestEventId() != headID {
		t.Fatalf("retention-gap event = %#v", delivered)
	}
}

func assertNoEventWithin(
	t *testing.T,
	subscription *Subscription,
	timeout time.Duration,
) {
	t.Helper()
	select {
	case event := <-subscription.Events:
		t.Fatalf("unexpected event: %#v", event)
	case <-time.After(timeout):
	}
}

type testWakeChannel struct {
	mu      sync.Mutex
	channel chan durableWakeHint
}

func newTestWakeChannel() *testWakeChannel {
	return &testWakeChannel{channel: make(chan durableWakeHint, 32)}
}

func (w *testWakeChannel) Emit(hint durableWakeHint) {
	w.mu.Lock()
	channel := w.channel
	w.mu.Unlock()
	select {
	case channel <- hint:
	default:
	}
}

func (w *testWakeChannel) Run(
	ctx context.Context,
	consume func(durableWakeHint),
) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case hint := <-w.channel:
			consume(hint)
		}
	}
}
