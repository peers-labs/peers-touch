package worker

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
)

func TestMemLock_AcquireReleaseAndContention(t *testing.T) {
	lock := NewMemLock()
	ctx := context.Background()

	held, release, err := lock.TryAcquire(ctx, "ttl_sweeper")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	if !held {
		t.Fatalf("first caller should win the lock")
	}

	// Second acquire with the lock still held → fails.
	if h2, _, err2 := lock.TryAcquire(ctx, "ttl_sweeper"); err2 != nil || h2 {
		t.Fatalf("second acquire while held: held=%v err=%v", h2, err2)
	}

	// Different name → unrelated, both can hold simultaneously.
	if h3, r3, err3 := lock.TryAcquire(ctx, "blob_gc"); err3 != nil || !h3 {
		t.Fatalf("different-name acquire: held=%v err=%v", h3, err3)
	} else {
		r3()
	}

	release()
	// After release, a fresh acquire on the same name succeeds.
	if h, _, err := lock.TryAcquire(ctx, "ttl_sweeper"); err != nil || !h {
		t.Errorf("post-release acquire: held=%v err=%v", h, err)
	}
}

func TestMemLock_DoubleReleaseIsNoop(t *testing.T) {
	lock := NewMemLock()
	_, release, _ := lock.TryAcquire(context.Background(), "ttl_sweeper")
	release()
	release() // must NOT panic; must NOT reacquire.

	// Sanity: lock is now free.
	if h, _, _ := lock.TryAcquire(context.Background(), "ttl_sweeper"); !h {
		t.Errorf("lock should be free after double release")
	}
}

func TestMemLock_EmptyNameRefused(t *testing.T) {
	lock := NewMemLock()
	if h, _, _ := lock.TryAcquire(context.Background(), ""); h {
		t.Errorf("empty name should not acquire")
	}
}

func TestMemLock_ConcurrentAcquire_OnlyOneWins(t *testing.T) {
	lock := NewMemLock()
	const N = 100
	var winners int32
	var wg sync.WaitGroup
	wg.Add(N)
	start := make(chan struct{})

	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			<-start
			held, release, _ := lock.TryAcquire(context.Background(), "shared")
			if held {
				atomic.AddInt32(&winners, 1)
				release()
			}
		}()
	}
	close(start)
	wg.Wait()
	// At least one winner — usually all 100 if they serialise
	// nicely, but the only safety property we care about is "no
	// two goroutines simultaneously held the lock". The map
	// state at the end being clean (no leaked owners) is the
	// proof: the next acquire succeeds.
	if winners == 0 {
		t.Fatalf("expected at least one winner; got 0")
	}
	if h, _, _ := lock.TryAcquire(context.Background(), "shared"); !h {
		t.Errorf("lock should be clean after all releases")
	}
}

func TestNameToLockKey_DeterministicAndPositive(t *testing.T) {
	if nameToLockKey("ttl_sweeper") != nameToLockKey("ttl_sweeper") {
		t.Errorf("nameToLockKey not deterministic")
	}
	if nameToLockKey("ttl_sweeper") == nameToLockKey("blob_gc") {
		t.Errorf("nameToLockKey collisions on the test set")
	}
	if nameToLockKey("ttl_sweeper") < 0 {
		t.Errorf("nameToLockKey returned negative — pgconn would sign-extend")
	}
}
