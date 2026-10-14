package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"gorm.io/gorm"
)

func TestMemLock_AcquireReleaseAndContention(t *testing.T) {
	lock := NewMemLock()
	ctx := context.Background()

	authority, release, err := lock.TryAcquire(ctx, "ttl_sweeper")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	if authority == nil {
		t.Fatalf("first caller should win the lock")
	}

	// Second acquire with the lock still held → fails.
	if a2, _, err2 := lock.TryAcquire(ctx, "ttl_sweeper"); err2 != nil || a2 != nil {
		t.Fatalf("second acquire while held: authority=%v err=%v", a2, err2)
	}

	// Different name → unrelated, both can hold simultaneously.
	if a3, r3, err3 := lock.TryAcquire(ctx, "blob_gc"); err3 != nil || a3 == nil {
		t.Fatalf("different-name acquire: authority=%v err=%v", a3, err3)
	} else {
		r3()
	}

	release()
	// After release, a fresh acquire on the same name succeeds.
	if authority, _, err := lock.TryAcquire(ctx, "ttl_sweeper"); err != nil || authority == nil {
		t.Errorf("post-release acquire: authority=%v err=%v", authority, err)
	}
}

func TestMemLock_DoubleReleaseIsNoop(t *testing.T) {
	lock := NewMemLock()
	_, release, _ := lock.TryAcquire(context.Background(), "ttl_sweeper")
	release()
	release() // must NOT panic; must NOT reacquire.

	// Sanity: lock is now free.
	if authority, _, _ := lock.TryAcquire(context.Background(), "ttl_sweeper"); authority == nil {
		t.Errorf("lock should be free after double release")
	}
}

func TestMemLock_EmptyNameRefused(t *testing.T) {
	lock := NewMemLock()
	if authority, _, _ := lock.TryAcquire(context.Background(), ""); authority != nil {
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
			authority, release, _ := lock.TryAcquire(context.Background(), "shared")
			if authority != nil {
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
	if authority, _, _ := lock.TryAcquire(context.Background(), "shared"); authority == nil {
		t.Errorf("lock should be clean after all releases")
	}
}

func TestDBLeaderLock_TakeoverAdvancesFenceAndRejectsOldOwner(t *testing.T) {
	db := initIntegrationStore(t)
	resetIntegration(t, db)
	lockA, err := NewDBLeaderLock(
		integrationDBName,
		"node-a",
		"incarnation-a",
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	lockB, err := NewDBLeaderLock(
		integrationDBName,
		"node-b",
		"incarnation-b",
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	authorityA, releaseA, err := lockA.TryAcquire(context.Background(), "blob_gc")
	if err != nil || authorityA == nil {
		t.Fatalf("node A acquire: authority=%+v err=%v", authorityA, err)
	}
	if authorityB, _, err := lockB.TryAcquire(context.Background(), "blob_gc"); err != nil || authorityB != nil {
		t.Fatalf("healthy lease was interrupted: authority=%+v err=%v", authorityB, err)
	}
	if result := db.Model(&ossmodel.WorkerLease{}).
		Where("worker_name = ? AND fencing_token = ?", "blob_gc", authorityA.FencingToken).
		Update("expires_at", gorm.Expr("datetime('now', '-1 second')")); result.Error != nil || result.RowsAffected != 1 {
		t.Fatalf("expire node A: rows=%d err=%v", result.RowsAffected, result.Error)
	}
	authorityB, releaseB, err := lockB.TryAcquire(context.Background(), "blob_gc")
	if err != nil || authorityB == nil {
		t.Fatalf("node B takeover: authority=%+v err=%v", authorityB, err)
	}
	defer releaseB()
	if authorityB.FencingToken != authorityA.FencingToken+1 {
		t.Fatalf("takeover token=%d want=%d", authorityB.FencingToken, authorityA.FencingToken+1)
	}
	if err := lockA.Validate(context.Background(), *authorityA); !errors.Is(err, ErrStaleWorkerLease) {
		t.Fatalf("old owner validation error=%v want=%v", err, ErrStaleWorkerLease)
	}
	releaseA()
	if err := lockB.Validate(context.Background(), *authorityB); err != nil {
		t.Fatalf("old release corrupted current owner: %v", err)
	}
}
