package events

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// counterIDGen returns ids "ev-0001", "ev-0002", ... so tests can
// reason about cursor ordering with simple string comparisons.
// String comparison preserves order because the suffix is zero-padded.
func counterIDGen() func() string {
	var (
		mu sync.Mutex
		n  int
	)
	return func() string {
		mu.Lock()
		defer mu.Unlock()
		n++
		return fmt.Sprintf("ev-%06d", n)
	}
}

func newTestBus(t *testing.T, opts ...BusOption) EventBus {
	t.Helper()
	defaults := []BusOption{
		WithIDGenerator(counterIDGen()),
		WithClock(func() time.Time {
			return time.Unix(0, 1_700_000_000_000_000_000) // fixed
		}),
	}
	return NewEventBus(append(defaults, opts...)...)
}

func newTestDurableStore(t *testing.T) durableEventStore {
	t.Helper()
	dsn := fmt.Sprintf("file:%s-%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	store := newGormEventStore(db)
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return store
}

func msg(text string) *realtime.StreamEvent {
	return &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Message{
			Message: &realtime.MessageEnvelope{
				Ulid:       text,
				Ciphertext: []byte(text),
			},
		},
	}
}

func TestPublish_StampsEventIDAndTimestamp(t *testing.T) {
	bus := newTestBus(t)
	id, err := bus.Publish("alice", msg("hi"))
	if err != nil {
		t.Fatal(err)
	}
	if id != "ev-000001" {
		t.Fatalf("event_id = %q, want ev-000001", id)
	}
}

func TestSubscribe_FirstConnect_NoReplay(t *testing.T) {
	bus := newTestBus(t)
	if _, err := bus.Publish("alice", msg("a")); err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Publish("alice", msg("b")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus.Subscribe(ctx, "alice", "dev-1", "")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-sub.Events:
		t.Fatal("first-connect subscriber should not see replay")
	case <-time.After(20 * time.Millisecond):
	}
}

func TestSubscribe_ReplaysFromCursor(t *testing.T) {
	bus := newTestBus(t)
	id1, _ := bus.Publish("alice", msg("a"))
	_, _ = bus.Publish("alice", msg("b"))
	_, _ = bus.Publish("alice", msg("c"))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus.Subscribe(ctx, "alice", "dev-1", id1)
	if err != nil {
		t.Fatal(err)
	}

	got := drainN(t, sub, 2, 50*time.Millisecond)
	if len(got) != 2 {
		t.Fatalf("got %d replayed events, want 2", len(got))
	}
	if got[0].GetMessage().GetUlid() != "b" || got[1].GetMessage().GetUlid() != "c" {
		t.Fatalf("replay order = %v", []string{got[0].GetMessage().GetUlid(), got[1].GetMessage().GetUlid()})
	}
}

func TestSubscribe_ResyncWhenCursorEvicted(t *testing.T) {
	bus := newTestBus(t, WithRingBufferSize(2))
	_, _ = bus.Publish("alice", msg("a"))
	_, _ = bus.Publish("alice", msg("b"))
	_, _ = bus.Publish("alice", msg("c")) // evicts a

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Pretend client cursor is "ev-000001" (the now-evicted "a").
	sub, _, err := bus.Subscribe(ctx, "alice", "dev-1", "ev-000001")
	if err != nil {
		t.Fatal(err)
	}
	got := drainN(t, sub, 1, 50*time.Millisecond)
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1 (Resync)", len(got))
	}
	if got[0].GetResync() == nil {
		t.Fatalf("first event = %T, want Resync", got[0].GetKind())
	}
}

func TestSubscribe_ResyncWhenBufferEmpty(t *testing.T) {
	// Simulate process restart: bus has no events, client has stale cursor.
	bus := newTestBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus.Subscribe(ctx, "alice", "dev-1", "ev-stale")
	if err != nil {
		t.Fatal(err)
	}
	got := drainN(t, sub, 1, 50*time.Millisecond)
	if len(got) != 1 || got[0].GetResync() == nil {
		t.Fatalf("expected Resync on empty-buffer cursor, got %#v", got)
	}
}

func TestSubscribe_ReplaysFromDurableStoreAfterRestart(t *testing.T) {
	store := newTestDurableStore(t)
	bus1 := newTestBus(t, WithDurableStore(store))
	id1, err := bus1.Publish("alice", msg("a"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bus1.Publish("alice", msg("b")); err != nil {
		t.Fatal(err)
	}
	if _, err := bus1.Publish("alice", msg("c")); err != nil {
		t.Fatal(err)
	}
	bus1.Close()

	bus2 := newTestBus(t, WithDurableStore(store))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus2.Subscribe(ctx, "alice", "dev-1", id1)
	if err != nil {
		t.Fatal(err)
	}

	got := drainN(t, sub, 2, 50*time.Millisecond)
	if len(got) != 2 {
		t.Fatalf("got %d durable replay events, want 2", len(got))
	}
	if got[0].GetMessage().GetUlid() != "b" || got[1].GetMessage().GetUlid() != "c" {
		t.Fatalf("durable replay order = %v", []string{got[0].GetMessage().GetUlid(), got[1].GetMessage().GetUlid()})
	}
}

func TestSubscribe_DurableReplayCanExceedSubscriberQueue(t *testing.T) {
	store := newTestDurableStore(t)
	bus1 := newTestBus(t, WithSubscriberQueue(8), WithDurableStore(store))
	cursor, err := bus1.Publish("alice", msg("cursor"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 70; i++ {
		if _, err := bus1.Publish("alice", msg(fmt.Sprintf("m-%02d", i))); err != nil {
			t.Fatal(err)
		}
	}
	bus1.Close()

	bus2 := newTestBus(t, WithSubscriberQueue(8), WithDurableStore(store))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus2.Subscribe(ctx, "alice", "dev-1", cursor)
	if err != nil {
		t.Fatal(err)
	}

	got := drainN(t, sub, 70, 50*time.Millisecond)
	if len(got) != 70 {
		t.Fatalf("got %d durable replay events, want 70", len(got))
	}
	if got[0].GetMessage().GetUlid() != "m-00" || got[69].GetMessage().GetUlid() != "m-69" {
		t.Fatalf("durable replay bounds = %q..%q, want m-00..m-69",
			got[0].GetMessage().GetUlid(),
			got[69].GetMessage().GetUlid(),
		)
	}
}

func TestSubscribe_DurableReplayIsNotCappedByRingSize(t *testing.T) {
	store := newTestDurableStore(t)
	bus1 := newTestBus(t, WithRingBufferSize(2), WithDurableStore(store))
	cursor, err := bus1.Publish("alice", msg("cursor"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := bus1.Publish("alice", msg(fmt.Sprintf("m-%02d", i))); err != nil {
			t.Fatal(err)
		}
	}
	bus1.Close()

	bus2 := newTestBus(t, WithRingBufferSize(2), WithDurableStore(store))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus2.Subscribe(ctx, "alice", "dev-1", cursor)
	if err != nil {
		t.Fatal(err)
	}

	got := drainN(t, sub, 5, 50*time.Millisecond)
	if len(got) != 5 {
		t.Fatalf("got %d durable replay events, want 5", len(got))
	}
	if got[0].GetMessage().GetUlid() != "m-00" || got[4].GetMessage().GetUlid() != "m-04" {
		t.Fatalf("durable replay bounds = %q..%q, want m-00..m-04",
			got[0].GetMessage().GetUlid(),
			got[4].GetMessage().GetUlid(),
		)
	}
}

func TestSubscribe_DurableReplayDoesNotDuplicateConcurrentPublish(t *testing.T) {
	store := newBlockingReplayStore()
	bus := newTestBus(t, WithDurableStore(store))
	cursor, err := bus.Publish("alice", msg("cursor"))
	if err != nil {
		t.Fatal(err)
	}
	store.blockNextPersist()

	publishErr := make(chan error, 1)
	go func() {
		_, err := bus.Publish("alice", msg("new"))
		publishErr <- err
	}()

	select {
	case <-store.persisted:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("publish did not reach durable persist")
	}

	subscribeDone := make(chan *Subscription, 1)
	subscribeErr := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		sub, _, err := bus.Subscribe(ctx, "alice", "dev-1", cursor)
		if err != nil {
			subscribeErr <- err
			return
		}
		subscribeDone <- sub
	}()

	select {
	case <-subscribeDone:
		t.Fatal("subscriber replayed while publish held actor lock")
	case err := <-subscribeErr:
		t.Fatalf("subscribe failed: %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	store.releasePersist()

	select {
	case err := <-publishErr:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("publish did not finish")
	}

	var sub *Subscription
	select {
	case sub = <-subscribeDone:
	case err := <-subscribeErr:
		t.Fatalf("subscribe failed: %v", err)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("subscribe did not finish")
	}

	got := drainN(t, sub, 2, 50*time.Millisecond)
	if len(got) != 1 {
		t.Fatalf("got %d events, want exactly 1 replay and no duplicate live fan-out", len(got))
	}
	if got[0].GetMessage().GetUlid() != "new" {
		t.Fatalf("got message %q, want new", got[0].GetMessage().GetUlid())
	}
}

func TestPublish_FanOutToMultipleSubscribers(t *testing.T) {
	bus := newTestBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s1, _, _ := bus.Subscribe(ctx, "alice", "dev-1", "")
	s2, _, _ := bus.Subscribe(ctx, "alice", "dev-2", "")

	if _, err := bus.Publish("alice", msg("hello")); err != nil {
		t.Fatal(err)
	}

	for _, sub := range []*Subscription{s1, s2} {
		select {
		case ev := <-sub.Events:
			if ev.GetMessage().GetUlid() != "hello" {
				t.Fatalf("subscriber got %q", ev.GetMessage().GetUlid())
			}
		case <-time.After(50 * time.Millisecond):
			t.Fatal("subscriber did not receive published event")
		}
	}
}

func TestPublishToDevice_TargetsLiveAndReplay(t *testing.T) {
	bus := newTestBus(t)
	floorID, err := bus.Publish("alice", msg("floor"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s1, _, _ := bus.Subscribe(ctx, "alice", "dev-1", "")
	s2, _, _ := bus.Subscribe(ctx, "alice", "dev-2", "")

	if _, err := bus.PublishToDevice("alice", "dev-1", msg("device-only")); err != nil {
		t.Fatal(err)
	}

	got := drainN(t, s1, 1, 50*time.Millisecond)
	if len(got) != 1 || got[0].GetMessage().GetUlid() != "device-only" {
		t.Fatalf("target device got %#v, want device-only", got)
	}
	select {
	case ev := <-s2.Events:
		t.Fatalf("non-target device received %#v", ev)
	case <-time.After(20 * time.Millisecond):
	}

	_, _ = bus.Publish("alice", msg("broadcast"))
	replayDev1, _, err := bus.Subscribe(ctx, "alice", "dev-1", floorID)
	if err != nil {
		t.Fatal(err)
	}
	replayed := drainN(t, replayDev1, 2, 50*time.Millisecond)
	if len(replayed) != 2 ||
		replayed[0].GetMessage().GetUlid() != "device-only" ||
		replayed[1].GetMessage().GetUlid() != "broadcast" {
		t.Fatalf("target replay = %#v, want device-only then broadcast", replayed)
	}

	replayDev2, _, err := bus.Subscribe(ctx, "alice", "dev-2", floorID)
	if err != nil {
		t.Fatal(err)
	}
	replayed = drainN(t, replayDev2, 1, 50*time.Millisecond)
	if len(replayed) != 1 || replayed[0].GetMessage().GetUlid() != "broadcast" {
		t.Fatalf("non-target replay = %#v, want only broadcast", replayed)
	}
}

func TestPublish_DropsWedgedSubscriber(t *testing.T) {
	// Queue capacity 1 — second publish without a reader wedges the channel.
	bus := newTestBus(t, WithSubscriberQueue(1))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, err := bus.Subscribe(ctx, "alice", "dev-1", "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := bus.Publish("alice", msg("a")); err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Publish("alice", msg("b")); err != nil {
		t.Fatal(err)
	}

	// Drain whatever fit; then expect the channel to be closed by the
	// drop path — i.e. the next receive must return ok=false.
	for {
		select {
		case _, ok := <-sub.Events:
			if !ok {
				if got := bus.Stats().WedgedDrops; got != 1 {
					t.Fatalf("WedgedDrops = %d, want 1", got)
				}
				return
			}
		case <-time.After(100 * time.Millisecond):
			t.Fatal("expected channel close after wedge, but it stayed open")
		}
	}
}

func TestPublish_RingBufferEvictsOldest(t *testing.T) {
	bus := newTestBus(t, WithRingBufferSize(3))
	for i := 0; i < 5; i++ {
		if _, err := bus.Publish("alice", msg(fmt.Sprintf("m-%d", i))); err != nil {
			t.Fatal(err)
		}
	}
	if got := bus.Stats().BufferedEvents; got != 3 {
		t.Fatalf("BufferedEvents = %d, want 3", got)
	}
}

func TestClose_UnsubscribesAll(t *testing.T) {
	bus := newTestBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub, _, _ := bus.Subscribe(ctx, "alice", "dev-1", "")
	bus.Close()

	select {
	case _, ok := <-sub.Events:
		if ok {
			t.Fatal("Close should close subscriber channels")
		}
	case <-time.After(50 * time.Millisecond):
		t.Fatal("Close did not close subscriber channel")
	}

	if _, err := bus.Publish("alice", msg("late")); err != ErrBusClosed {
		t.Fatalf("Publish after Close = %v, want ErrBusClosed", err)
	}
}

func TestPublish_DoesNotMutateCallersEvent(t *testing.T) {
	// The bus contract is: callers may reuse the same *StreamEvent
	// across two Publish calls (e.g. multi-device sender echo).
	// Both fan-outs must see distinct stamped event_ids and the
	// caller's pointer must be untouched.
	bus := newTestBus(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subA, _, _ := bus.Subscribe(ctx, "alice", "dev-a", "")
	subB, _, _ := bus.Subscribe(ctx, "bob", "dev-b", "")

	shared := msg("hello")
	if _, err := bus.Publish("alice", shared); err != nil {
		t.Fatal(err)
	}
	if shared.EventId != "" || shared.TsUnixMs != 0 {
		t.Fatalf("Publish mutated caller event_id=%q ts=%d", shared.EventId, shared.TsUnixMs)
	}
	if _, err := bus.Publish("bob", shared); err != nil {
		t.Fatal(err)
	}

	a := drainN(t, subA, 1, 50*time.Millisecond)
	b := drainN(t, subB, 1, 50*time.Millisecond)
	if len(a) != 1 || len(b) != 1 {
		t.Fatalf("expected 1 event each, got a=%d b=%d", len(a), len(b))
	}
	if a[0].EventId == b[0].EventId {
		t.Fatalf("expected distinct event_ids, both = %q", a[0].EventId)
	}
	if a[0] == b[0] {
		t.Fatal("subscribers received the SAME pointer; bus must clone")
	}
}

func TestEventID_MonotonicAcrossPublishes(t *testing.T) {
	bus := newTestBus(t)
	prev := ""
	for i := 0; i < 16; i++ {
		id, err := bus.Publish("alice", msg("x"))
		if err != nil {
			t.Fatal(err)
		}
		if id <= prev {
			t.Fatalf("id %q not greater than previous %q", id, prev)
		}
		prev = id
	}
}

// drainN reads up to n events from sub, with a deadline per event.
// It is best-effort: returns whatever it managed to pull.
func drainN(t *testing.T, sub *Subscription, n int, perEvent time.Duration) []*realtime.StreamEvent {
	t.Helper()
	out := make([]*realtime.StreamEvent, 0, n)
	for i := 0; i < n; i++ {
		select {
		case ev, ok := <-sub.Events:
			if !ok {
				return out
			}
			out = append(out, ev)
		case <-time.After(perEvent):
			return out
		}
	}
	return out
}

type blockingReplayStore struct {
	mu           sync.Mutex
	events       map[string][]*realtime.StreamEvent
	blockPersist bool
	persisted    chan struct{}
	release      chan struct{}
}

func newBlockingReplayStore() *blockingReplayStore {
	return &blockingReplayStore{
		events:    make(map[string][]*realtime.StreamEvent),
		persisted: make(chan struct{}, 1),
		release:   make(chan struct{}),
	}
}

func (s *blockingReplayStore) blockNextPersist() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blockPersist = true
	s.persisted = make(chan struct{}, 1)
	s.release = make(chan struct{})
}

func (s *blockingReplayStore) releasePersist() {
	close(s.release)
}

func (s *blockingReplayStore) Persist(actorID string, ev *realtime.StreamEvent) error {
	cloned := proto.Clone(ev).(*realtime.StreamEvent)

	s.mu.Lock()
	s.events[actorID] = append(s.events[actorID], cloned)
	block := s.blockPersist
	persisted := s.persisted
	release := s.release
	if block {
		s.blockPersist = false
	}
	s.mu.Unlock()

	if block {
		persisted <- struct{}{}
		<-release
	}
	return nil
}

func (s *blockingReplayStore) ReplayAfter(actorID, cursor string, limit int) ([]*realtime.StreamEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]*realtime.StreamEvent, 0)
	for _, ev := range s.events[actorID] {
		if ev.GetEventId() <= cursor {
			continue
		}
		out = append(out, proto.Clone(ev).(*realtime.StreamEvent))
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *blockingReplayStore) NewestEventID(actorID string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	events := s.events[actorID]
	if len(events) == 0 {
		return "", false, nil
	}
	return events[len(events)-1].GetEventId(), true, nil
}
