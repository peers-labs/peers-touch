// Package worker — background lifecycle workers for the OSS subserver.
//
// Each worker is a small, single-purpose job scheduled on a fixed
// interval by `Scheduler`. The scheduler does NOT enforce
// inter-worker ordering; workers are independent by design (see
// the rationale on each Worker implementation for why their
// failures must never cascade).
//
// Multi-instance safety:
//
//	Stations may run more than one OSS subserver instance against a
//	shared database (HA / rolling-deploy). The scheduler asks the
//	configured `LeaderLock` to TryAcquire before each tick — only
//	the lock holder runs the job. The lock implementation chosen at
//	startup decides the granularity:
//	  - `MemLock`  : per-process (single-instance deployments + tests).
//	  - `PgAdvisoryLock` (S12+) : cluster-wide via pg_try_advisory_lock.
//
// Audit emission:
//
//	The scheduler emits one `worker_run` audit row per tick (with
//	outcome=ok/error and reason=<worker name>) so operators can
//	answer "did the worker run?" from the audit log alone, without
//	depending on the metrics endpoint. Per-row mutations the worker
//	body performs (e.g. ttl_expired soft deletes) emit their own
//	audit rows under the lifecycle action set (`delete`,
//	`blob_gc`, …) — the worker_run row is the schedule heartbeat,
//	not the per-item log.
package worker

import (
	"context"
	"errors"
	"sync"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// Worker is the contract every background job implements. The
// scheduler treats workers as opaque values: it knows their name,
// their interval, and how to call them.
type Worker interface {
	// Name returns a stable identifier for the worker. Used by
	// the leader lock (lock key) and by audit / metric emission.
	// Must be unique across the registered worker set; the
	// scheduler does not deduplicate.
	Name() string

	// Interval is the cadence at which RunOnce is invoked.
	// Returning <= 0 disables the worker (the scheduler skips
	// it at registration time, so an operator-zeroed interval
	// is a clean disable rather than a tight loop).
	Interval() time.Duration

	// RunOnce performs one scheduled invocation. The context
	// carries the scheduler's shutdown deadline; respect it.
	// Returning a non-nil error is logged and emitted as an
	// audit row but does not affect future ticks — workers are
	// expected to recover on the next interval.
	RunOnce(ctx context.Context) error
}

// Scheduler runs a set of Workers on their declared intervals,
// coordinating multi-instance leadership via the supplied lock.
//
// The zero value is not usable; construct via NewScheduler.
type Scheduler struct {
	workers []Worker
	lock    LeaderLock
	audit   repo.AuditRepository
	clock   func() time.Time

	mu     sync.Mutex
	cancel context.CancelFunc
	wg     sync.WaitGroup
	stopCh chan struct{}

	statsMu sync.RWMutex
	stats   map[string]*workerStats
}

// workerStats captures the rolling state of a single worker. It
// lives entirely in the scheduler's process so a restart resets
// it — durable history goes through the `oss_audit` heartbeat
// rows. The snapshot view (`Snapshot()`) feeds `/healthz` /
// `/metrics` and the dashboard "workers" tab.
type workerStats struct {
	interval     time.Duration
	lastRunAt    time.Time
	lastDuration time.Duration
	lastOutcome  string // "ok" | "error" | "" (never run)
	lastError    string
	runCount     uint64
	errorCount   uint64
}

// WorkerSnapshot is the read-only projection one worker exposes to
// the observability surface. Times are zero when the worker has
// never run in this process; callers should branch on
// `LastRunAt.IsZero()`.
//
// `RunCount` / `ErrorCount` are process-local counters (reset on
// restart). For long-horizon trends operators should query
// `oss_audit` directly — see `AuditActionWorkerRun`.
type WorkerSnapshot struct {
	Name         string
	Interval     time.Duration
	LastRunAt    time.Time
	LastDuration time.Duration
	LastOutcome  string
	LastError    string
	RunCount     uint64
	ErrorCount   uint64
}

// Snapshot returns the current rolling stats for every registered
// worker. The result is a fresh slice safe for callers to retain;
// no scheduler-internal pointers are exposed.
func (s *Scheduler) Snapshot() []WorkerSnapshot {
	out := make([]WorkerSnapshot, 0, len(s.workers))
	s.statsMu.RLock()
	defer s.statsMu.RUnlock()
	for _, w := range s.workers {
		st := s.stats[w.Name()]
		snap := WorkerSnapshot{
			Name:     w.Name(),
			Interval: w.Interval(),
		}
		if st != nil {
			snap.LastRunAt = st.lastRunAt
			snap.LastDuration = st.lastDuration
			snap.LastOutcome = st.lastOutcome
			snap.LastError = st.lastError
			snap.RunCount = st.runCount
			snap.ErrorCount = st.errorCount
		}
		out = append(out, snap)
	}
	return out
}

// NewScheduler builds a Scheduler bound to the given workers, lock
// implementation and (optional) audit repository for heartbeat
// rows. A nil audit repo silently skips heartbeat emission;
// disabling audit at the scheduler boundary is a clean way to opt
// tests out of the noise.
func NewScheduler(workers []Worker, lock LeaderLock, audit repo.AuditRepository) *Scheduler {
	if lock == nil {
		// MemLock is a sane fallback for single-instance
		// deployments; the boot path may pass nil
		// intentionally and we should not crash.
		lock = NewMemLock()
	}
	return &Scheduler{
		workers: workers,
		lock:    lock,
		audit:   audit,
		clock:   time.Now,
		stopCh:  make(chan struct{}),
		stats:   make(map[string]*workerStats, len(workers)),
	}
}

// Start spawns one goroutine per worker. Returns an error only if
// the scheduler was already started (idempotency check); per-worker
// failures are surfaced via audit / log emission. Workers with
// `Interval() <= 0` are silently skipped.
//
// Use ctx for the upstream lifecycle (e.g. subserver Stop). The
// scheduler also keeps its own internal cancel hooked up so callers
// can either cancel via ctx OR call Stop().
func (s *Scheduler) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		return errors.New("worker: scheduler already started")
	}
	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.stopCh = make(chan struct{})

	for _, w := range s.workers {
		if w.Interval() <= 0 {
			log.Infof(ctx, "[oss-worker] %s disabled (interval <= 0)", w.Name())
			continue
		}
		s.wg.Add(1)
		go s.run(runCtx, w)
	}
	close(s.stopCh) // signal: started; subsequent Stop() can proceed.
	return nil
}

// Stop cancels in-flight runs and waits for all worker goroutines
// to exit. Safe to call multiple times — subsequent calls are
// no-ops once the scheduler has fully drained.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.wg.Wait()
}

// run is the per-worker loop. We deliberately do NOT skew the
// initial tick: each worker fires immediately on Start so a fresh
// boot does not wait `Interval()` before catching up on overdue
// work (e.g. expired files that piled up while the station was
// offline). Subsequent ticks honour the configured interval.
func (s *Scheduler) run(ctx context.Context, w Worker) {
	defer s.wg.Done()

	// Tick once at boot, then on the timer.
	s.tick(ctx, w)
	t := time.NewTicker(w.Interval())
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick(ctx, w)
		}
	}
}

// tick guards a single RunOnce with leader election + audit. Errors
// are swallowed (audited) so a transient failure does not kill the
// per-worker goroutine.
func (s *Scheduler) tick(ctx context.Context, w Worker) {
	if ctx.Err() != nil {
		return
	}
	held, release, err := s.lock.TryAcquire(ctx, w.Name())
	if err != nil {
		log.Warnf(ctx, "[oss-worker] %s lock acquire error: %v", w.Name(), err)
		return
	}
	if !held {
		// Another instance is currently the leader. Skip
		// silently — we will get our chance on the next tick
		// if the leader fails over.
		return
	}
	defer release()

	start := s.clock()
	rerr := w.RunOnce(ctx)
	elapsed := s.clock().Sub(start)

	if rerr != nil {
		log.Warnf(ctx, "[oss-worker] %s run error after %s: %v", w.Name(), elapsed, rerr)
	}
	s.recordStats(w, start, elapsed, rerr)
	s.emitHeartbeat(ctx, w.Name(), rerr)
}

// recordStats updates the rolling per-worker counters consumed by
// `Snapshot()`. Counters never reset within the process; on
// restart they begin at zero again — durable history is the
// `oss_audit` heartbeat row stream.
func (s *Scheduler) recordStats(w Worker, start time.Time, elapsed time.Duration, runErr error) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	st, ok := s.stats[w.Name()]
	if !ok {
		st = &workerStats{interval: w.Interval()}
		s.stats[w.Name()] = st
	}
	st.lastRunAt = start
	st.lastDuration = elapsed
	st.runCount++
	if runErr != nil {
		st.lastOutcome = ossmodel.AuditOutcomeError
		st.lastError = runErr.Error()
		st.errorCount++
	} else {
		st.lastOutcome = ossmodel.AuditOutcomeOK
		st.lastError = ""
	}
}

// emitHeartbeat appends one row to oss_audit so the dashboard /
// observability stack can answer "is the worker alive?" from
// audit history alone. Failures here are logged but never
// surfaced — the heartbeat must not break the worker loop.
func (s *Scheduler) emitHeartbeat(ctx context.Context, name string, runErr error) {
	if s.audit == nil {
		return
	}
	outcome := ossmodel.AuditOutcomeOK
	reason := name
	if runErr != nil {
		outcome = ossmodel.AuditOutcomeError
		reason = name + ": " + runErr.Error()
		if len(reason) > 120 {
			reason = reason[:120]
		}
	}
	if err := s.audit.Append(ctx, ossmodel.Audit{
		Action:  ossmodel.AuditActionWorkerRun,
		Outcome: outcome,
		Reason:  reason,
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] %s heartbeat audit append failed: %v", name, err)
	}
}
