// LeaderLock — multi-instance coordination for the OSS workers.
//
// The lock is held *for the duration of one tick*: the scheduler
// asks `TryAcquire` at the top of every interval, runs the worker
// body if and only if the lock was acquired, and releases as the
// tick returns. This is intentionally finer-grained than a
// "leader for life" model — it tolerates rolling restarts (the
// new instance picks up work on the next tick) and crashes (the
// timeout-based Postgres advisory lock or the in-process MemLock
// release path drops the lock without operator intervention).
//
// Two implementations:
//
//	- MemLock          : in-process; the right choice for
//	                     single-instance deployments and unit tests.
//	- PgAdvisoryLock   : (S12) cluster-wide via pg_try_advisory_lock.
//	                     Lives in a follow-up slice so this one stays
//	                     focused on the worker scaffolding.
//
// LeaderLock is the one place where multi-instance correctness
// gets enforced; the workers themselves are stateless and can be
// reasoned about per-tick.
package worker

import (
	"context"
	"hash/fnv"
	"sync"
)

// LeaderLock is the coordination primitive the Scheduler uses to
// decide whether THIS instance should run a given worker tick.
type LeaderLock interface {
	// TryAcquire attempts to acquire the lock for `name`.
	//
	// Returns:
	//   - held=true with a release func when this caller is now
	//     the leader. The caller MUST invoke release exactly
	//     once (the scheduler `defer release()`s).
	//   - held=false with a no-op release when another holder
	//     currently owns the lock. Callers should NOT call
	//     release (calling it is harmless but logs a warning
	//     in some implementations).
	//   - err != nil only on transport / driver failure.
	//     Held-or-not is conveyed via `held`; missing locks are
	//     not errors.
	TryAcquire(ctx context.Context, name string) (held bool, release func(), err error)
}

// MemLock is an in-process LeaderLock. Use it for single-instance
// stations, tests, and the SQLite test backend (where Postgres
// advisory locks are unavailable). It is safe for concurrent use
// across goroutines but does NOT cross process boundaries.
type MemLock struct {
	mu    sync.Mutex
	owned map[string]struct{}
}

// NewMemLock builds a fresh MemLock with an empty ownership map.
func NewMemLock() *MemLock {
	return &MemLock{owned: make(map[string]struct{})}
}

// TryAcquire honours the LeaderLock contract over an in-process
// map. The release func is bound to the lock + name pair and is
// idempotent — calling it twice is a no-op (we cannot detect
// double-release without a per-lock token, and false alarms
// would be worse than the silent drop).
func (l *MemLock) TryAcquire(_ context.Context, name string) (bool, func(), error) {
	if name == "" {
		return false, func() {}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, taken := l.owned[name]; taken {
		return false, func() {}, nil
	}
	l.owned[name] = struct{}{}
	released := false
	release := func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		if released {
			return
		}
		released = true
		delete(l.owned, name)
	}
	return true, release, nil
}

// nameToLockKey is a deterministic int64 derived from a worker
// name. The pg advisory-lock implementation (S12) will use it as
// the lock identifier; we expose the helper here so MemLock and
// future PgAdvisoryLock agree on the key derivation, making test
// assertions portable.
//
// FNV-1a 64 bit is good enough — the worker name space is small
// (single-digit) and the function is collision-resistant within
// that range. We coerce to int64 by chopping the high bit so the
// pgconn driver does not have to sign-extend.
func nameToLockKey(name string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(name))
	v := int64(h.Sum64() &^ (1 << 63))
	return v
}
