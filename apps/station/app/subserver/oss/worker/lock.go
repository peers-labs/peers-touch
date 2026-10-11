// LeaderLock — multi-instance coordination for the OSS workers.
//
// The lock is held *for the duration of one tick*: the scheduler
// asks `TryAcquire` at the top of every interval, runs the worker
// body if and only if the lock was acquired, and releases as the
// tick returns. This is intentionally finer-grained than a
// "leader for life" model — it tolerates rolling restarts (the
// new instance picks up work on the next tick) and crashes (the
// database-time lease expires without operator intervention).
//
// Two implementations:
//
//   - MemLock: in-process test implementation.
//   - DBLeaderLock: shared production lease with node identity,
//     incarnation, renewal, and monotonic fencing.
//
// LeaderLock is the one place where multi-instance correctness
// gets enforced; the workers themselves are stateless and can be
// reasoned about per-tick.
package worker

import (
	"context"
	"sync"
	"time"
)

// LeaderLock is the coordination primitive the Scheduler uses to
// decide whether THIS instance should run a given worker tick.
type LeaderLock interface {
	TryAcquire(ctx context.Context, name string) (*LeaseAuthority, func(), error)
	Renew(ctx context.Context, authority LeaseAuthority) (*LeaseAuthority, error)
	Validate(ctx context.Context, authority LeaseAuthority) error
}

// LeaseAuthority is the immutable authority carried into one worker
// tick. Durable worker effects bind this tuple, not merely the worker
// name.
type LeaseAuthority struct {
	WorkerName       string
	OwnerNodePeerID  string
	OwnerIncarnation string
	FencingToken     uint64
	ExpiresAt        time.Time
}

type leaseAuthorityContextKey struct{}

func withLeaseAuthority(ctx context.Context, authority LeaseAuthority) context.Context {
	return context.WithValue(ctx, leaseAuthorityContextKey{}, authority)
}

// LeaseAuthorityFromContext returns the authority of the current
// scheduler tick. Workers that create durable external effects must
// reject a missing authority.
func LeaseAuthorityFromContext(ctx context.Context) (LeaseAuthority, bool) {
	authority, ok := ctx.Value(leaseAuthorityContextKey{}).(LeaseAuthority)
	return authority, ok
}

// MemLock is an in-process LeaderLock for tests and SQLite fixtures.
// It is safe for concurrent use across goroutines but does NOT cross
// process boundaries and is never selected by production OSS wiring.
type MemLock struct {
	mu    sync.Mutex
	owned map[string]struct{}
	token map[string]uint64
}

// NewMemLock builds a fresh MemLock with an empty ownership map.
func NewMemLock() *MemLock {
	return &MemLock{
		owned: make(map[string]struct{}),
		token: make(map[string]uint64),
	}
}

// TryAcquire honours the LeaderLock contract over an in-process
// map. The release func is bound to the lock + name pair and is
// idempotent — calling it twice is a no-op (we cannot detect
// double-release without a per-lock token, and false alarms
// would be worse than the silent drop).
func (l *MemLock) TryAcquire(_ context.Context, name string) (*LeaseAuthority, func(), error) {
	if name == "" {
		return nil, func() {}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, taken := l.owned[name]; taken {
		return nil, func() {}, nil
	}
	l.owned[name] = struct{}{}
	l.token[name]++
	token := l.token[name]
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
	return &LeaseAuthority{
		WorkerName:       name,
		OwnerNodePeerID:  "in-process",
		OwnerIncarnation: "mem-lock",
		FencingToken:     token,
		ExpiresAt:        time.Now().Add(24 * time.Hour),
	}, release, nil
}

func (l *MemLock) Renew(_ context.Context, authority LeaseAuthority) (*LeaseAuthority, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, held := l.owned[authority.WorkerName]; !held ||
		l.token[authority.WorkerName] != authority.FencingToken {
		return nil, ErrStaleWorkerLease
	}
	authority.ExpiresAt = time.Now().Add(24 * time.Hour)
	return &authority, nil
}

func (l *MemLock) Validate(_ context.Context, authority LeaseAuthority) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, held := l.owned[authority.WorkerName]; !held ||
		l.token[authority.WorkerName] != authority.FencingToken {
		return ErrStaleWorkerLease
	}
	return nil
}
