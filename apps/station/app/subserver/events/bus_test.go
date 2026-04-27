package events

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
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
