package federation

import (
	"context"
	"testing"
	"time"
)

func TestRotateLocalKey_PromotesNewAndDemotesOld(t *testing.T) {
	store := NewInMemoryKeyStore()
	cache := NewKeyCache(store, WithRecheckTTL(0))
	first, err := cache.Get(context.Background())
	if err != nil {
		t.Fatalf("warm: %v", err)
	}

	res, err := RotateLocalKey(context.Background(), store, cache)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if res.PreviousKid != first.Kid {
		t.Errorf("prev kid: %q vs %q", res.PreviousKid, first.Kid)
	}
	if res.NewKid == first.Kid {
		t.Errorf("expected fresh kid, got %q", res.NewKid)
	}

	// Cache should now serve the rotated key on the next
	// Get (because Rotate reset the once-Do gate).
	got, err := cache.Get(context.Background())
	if err != nil {
		t.Fatalf("post-rotate get: %v", err)
	}
	if got.Kid != res.NewKid {
		t.Errorf("cache stale: got %q want %q", got.Kid, res.NewKid)
	}
}

func TestRotateLocalKey_FirstRotationOnEmptyStore(t *testing.T) {
	store := NewInMemoryKeyStore()
	res, err := RotateLocalKey(context.Background(), store, nil)
	if err != nil {
		t.Fatalf("rotate empty: %v", err)
	}
	if res.PreviousKid != "" {
		t.Errorf("expected empty PreviousKid on first rotation, got %q", res.PreviousKid)
	}
	if res.NewKid == "" {
		t.Errorf("expected non-empty NewKid")
	}
}

func TestRotateLocalKey_NilStoreErrors(t *testing.T) {
	if _, err := RotateLocalKey(context.Background(), nil, nil); err == nil {
		t.Fatalf("expected nil-store error")
	}
}

func TestFinalizePrevKey_NoPrevIsNoop(t *testing.T) {
	store := NewInMemoryKeyStore()
	cleared, kid, err := FinalizePrevKey(context.Background(), store, time.Hour)
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}
	if cleared {
		t.Errorf("expected cleared=false on empty prev")
	}
	if kid != "" {
		t.Errorf("expected empty kid, got %q", kid)
	}
}

func TestFinalizePrevKey_PrevWithinGraceIsKept(t *testing.T) {
	store := NewInMemoryKeyStore()
	first, _ := MintLocalKey(time.Now())
	_ = store.PutCurrent(context.Background(), first)
	second, _ := MintLocalKey(time.Now())
	if _, err := store.Rotate(context.Background(), second); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	cleared, _, err := FinalizePrevKey(context.Background(), store, time.Hour)
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}
	if cleared {
		t.Errorf("expected prev preserved when fresh; cleared=true")
	}
	prev, err := store.Load(context.Background(), SlotPrev)
	if err != nil || prev.Kid != first.Kid {
		t.Errorf("prev should still be loadable: err=%v kid=%q", err, prev)
	}
}

func TestFinalizePrevKey_PrevPastGraceIsCleared(t *testing.T) {
	store := NewInMemoryKeyStore()
	old, _ := MintLocalKey(time.Now().Add(-2 * time.Hour))
	_ = store.PutCurrent(context.Background(), old)
	current, _ := MintLocalKey(time.Now().Add(-2 * time.Hour))
	if _, err := store.Rotate(context.Background(), current); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	cleared, kid, err := FinalizePrevKey(context.Background(), store, time.Hour)
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}
	if !cleared {
		t.Errorf("expected cleared=true past grace")
	}
	if kid != old.Kid {
		t.Errorf("cleared kid: got %q want %q", kid, old.Kid)
	}
}
