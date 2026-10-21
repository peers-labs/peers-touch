package ingress

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

func event(binding, eventID, messageID string) *model.NormalizedInboundEvent {
	return &model.NormalizedInboundEvent{
		BindingId: binding,
		EventId:   eventID,
		MessageId: messageID,
		Text:      "hello",
	}
}

// TestDeduplicateCompletedLeader: the second delivery after a completed
// leader is skipped without invoking the downstream handler again.
func TestDeduplicateCompletedLeader(t *testing.T) {
	var calls int
	cache := newDedupCache(16, time.Minute)
	h := DeduplicateMiddlewareWithCache(cache)(func(_ context.Context, _ *model.NormalizedInboundEvent) (string, error) {
		calls++
		return "", nil
	})

	if _, err := h(context.Background(), event("b1", "e1", "m1")); err != nil {
		t.Fatalf("leader: %v", err)
	}
	if _, err := h(context.Background(), event("b1", "e1", "m1")); err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if calls != 1 {
		t.Fatalf("downstream invoked %d times, want 1", calls)
	}
}

// TestDeduplicateConcurrentLeader: a duplicate arriving while the leader is
// in flight waits for the leader's explicit admission and returns without
// running downstream.
func TestDeduplicateConcurrentLeader(t *testing.T) {
	cache := newDedupCache(16, time.Minute)
	var calls int
	admit := make(chan struct{})
	observerCh := make(chan func(bool), 1)
	h := DeduplicateMiddlewareWithCache(cache)(func(ctx context.Context, _ *model.NormalizedInboundEvent) (string, error) {
		calls++
		<-admit
		return "", nil
	})

	leaderDone := make(chan struct{})
	go func() {
		defer close(leaderDone)
		ctx := WithRuntimeCallbacks(context.Background(), RuntimeCallbacks{
			MarkAccepted:               func() {},
			RegisterAcceptanceObserver: func(o func(bool)) { observerCh <- o },
		})
		_, _ = h(ctx, event("b1", "e1", "m1"))
	}()

	var observer func(bool)
	select {
	case observer = <-observerCh:
	case <-time.After(2 * time.Second):
		t.Fatal("leader never registered acceptance observer")
	}

	dupDone := make(chan error, 1)
	go func() {
		ctx := WithRuntimeCallbacks(context.Background(), RuntimeCallbacks{MarkAccepted: func() {}})
		_, err := h(ctx, event("b1", "e1", "m1"))
		dupDone <- err
	}()

	waitFor(t, func() bool {
		cache.mu.Lock()
		defer cache.mu.Unlock()
		e := cache.entries["event:b1\x00e1"]
		return e != nil && e.waiters > 0
	})

	// Leader admits asynchronously (durable turn admission point).
	observer(true)
	close(admit)

	select {
	case err := <-dupDone:
		if err != nil {
			t.Fatalf("duplicate should succeed after admission: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("duplicate did not unblock after leader admission")
	}
	<-leaderDone
	if calls != 1 {
		t.Fatalf("downstream invoked %d times, want 1", calls)
	}
}

// TestDeduplicateLeaderFailureRequestsRetry: a leader that errors before
// admission makes a waiting duplicate return ErrRetryOnly so the platform
// redelivers.
func TestDeduplicateLeaderFailureRequestsRetry(t *testing.T) {
	cache := newDedupCache(16, time.Minute)
	admit := make(chan struct{})
	observerCh := make(chan func(bool), 1)
	h := DeduplicateMiddlewareWithCache(cache)(func(_ context.Context, _ *model.NormalizedInboundEvent) (string, error) {
		<-admit
		return "", errors.New("database down")
	})

	go func() {
		ctx := WithRuntimeCallbacks(context.Background(), RuntimeCallbacks{
			RegisterAcceptanceObserver: func(o func(bool)) { observerCh <- o },
		})
		_, _ = h(ctx, event("b1", "e9", "m9"))
	}()

	var observer func(bool)
	select {
	case observer = <-observerCh:
	case <-time.After(2 * time.Second):
		t.Fatal("leader never registered acceptance observer")
	}

	dupDone := make(chan error, 1)
	go func() {
		_, err := h(context.Background(), event("b1", "e9", "m9"))
		dupDone <- err
	}()

	// Do not fail the leader until the duplicate is actually waiting.
	waitFor(t, func() bool {
		cache.mu.Lock()
		defer cache.mu.Unlock()
		e := cache.entries["event:b1\x00e9"]
		return e != nil && e.waiters > 0
	})

	observer(false)
	close(admit)

	select {
	case err := <-dupDone:
		if !errors.Is(err, ErrRetryOnly) {
			t.Fatalf("want ErrRetryOnly, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("duplicate did not unblock after leader failure")
	}

	// After a failed leader the entry is gone, so a redelivery becomes a new
	// leader (platform retry is safe).
	cache.mu.Lock()
	_, present := cache.entries["event:b1\x00e9"]
	cache.mu.Unlock()
	if present {
		t.Fatal("failed leader entry must be removed so redelivery runs")
	}
}

// TestDeduplicateSecondaryMessageID catches the same message delivered with
// a different event id (P1/P2 dual delivery).
func TestDeduplicateSecondaryMessageID(t *testing.T) {
	var mu sync.Mutex
	var calls int
	cache := newDedupCache(16, time.Minute)
	h := DeduplicateMiddlewareWithCache(cache)(func(_ context.Context, _ *model.NormalizedInboundEvent) (string, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		return "", nil
	})

	if _, err := h(context.Background(), event("b1", "event-v2", "om_same")); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := h(context.Background(), event("b1", "event-v1", "om_same")); err != nil {
		t.Fatalf("dual delivery: %v", err)
	}
	if calls != 1 {
		t.Fatalf("downstream invoked %d times, want 1", calls)
	}
}

// TestDeduplicateScopedByBinding: identical event ids on different bindings
// are independent.
func TestDeduplicateScopedByBinding(t *testing.T) {
	var calls int
	cache := newDedupCache(16, time.Minute)
	h := DeduplicateMiddlewareWithCache(cache)(func(_ context.Context, _ *model.NormalizedInboundEvent) (string, error) {
		calls++
		return "", nil
	})
	_, _ = h(context.Background(), event("b1", "e1", "m1"))
	_, _ = h(context.Background(), event("b2", "e1", "m1"))
	if calls != 2 {
		t.Fatalf("different bindings must run independently, calls=%d", calls)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}
