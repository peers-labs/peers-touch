package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// fakeWorker implements Worker for scheduler tests.
type fakeWorker struct {
	name     string
	interval time.Duration
	runCount int64
	runErr   error
	onRun    func()
}

func (w *fakeWorker) Name() string            { return w.name }
func (w *fakeWorker) Interval() time.Duration { return w.interval }
func (w *fakeWorker) RunOnce(_ context.Context) error {
	atomic.AddInt64(&w.runCount, 1)
	if w.onRun != nil {
		w.onRun()
	}
	return w.runErr
}

// recordingAudit captures audit appends so the heartbeat
// assertions can read them back without a database.
type recordingAudit struct {
	mu        sync.Mutex
	rows      []ossmodel.Audit
	appendErr error
}

func (a *recordingAudit) Append(_ context.Context, evt ossmodel.Audit) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.appendErr != nil {
		return a.appendErr
	}
	a.rows = append(a.rows, evt)
	return nil
}
func (a *recordingAudit) Query(context.Context, ossrepo.AuditQuery) ([]ossmodel.Audit, int64, error) {
	return nil, 0, nil
}
func (a *recordingAudit) Trim(context.Context, time.Time) (int64, error) { return 0, nil }

func (a *recordingAudit) snapshot() []ossmodel.Audit {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]ossmodel.Audit, len(a.rows))
	copy(out, a.rows)
	return out
}

func TestScheduler_RunsOnceImmediatelyAndOnInterval(t *testing.T) {
	w := &fakeWorker{name: "ttl_sweeper", interval: 50 * time.Millisecond}
	audit := &recordingAudit{}
	sched := NewScheduler([]Worker{w}, NewMemLock(), audit)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(160 * time.Millisecond) // ~3 ticks: boot + 2 timer.
	sched.Stop()

	got := atomic.LoadInt64(&w.runCount)
	if got < 2 {
		t.Errorf("expected >= 2 runs (boot + at least 1 ticker), got %d", got)
	}
	rows := audit.snapshot()
	if len(rows) < 2 {
		t.Errorf("expected >= 2 heartbeat rows, got %d", len(rows))
	}
	for _, r := range rows {
		if r.Action != ossmodel.AuditActionWorkerRun {
			t.Errorf("heartbeat action: want %q, got %q", ossmodel.AuditActionWorkerRun, r.Action)
		}
		if r.Outcome != ossmodel.AuditOutcomeOK {
			t.Errorf("heartbeat outcome: want ok, got %q (reason=%s)", r.Outcome, r.Reason)
		}
		if r.Reason != "ttl_sweeper" {
			t.Errorf("heartbeat reason: want ttl_sweeper, got %q", r.Reason)
		}
	}
}

func TestScheduler_DisabledWorkerSkipped(t *testing.T) {
	w := &fakeWorker{name: "ttl_sweeper", interval: 0} // disabled
	sched := NewScheduler([]Worker{w}, NewMemLock(), nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	sched.Stop()

	if got := atomic.LoadInt64(&w.runCount); got != 0 {
		t.Errorf("disabled worker should not run; got %d runs", got)
	}
}

func TestScheduler_ContendingLockSkipsTickSilently(t *testing.T) {
	// Pre-acquire the lock so the scheduler observes it as
	// "held by someone else" and skips the run.
	lock := NewMemLock()
	_, _, _ = lock.TryAcquire(context.Background(), "ttl_sweeper")

	w := &fakeWorker{name: "ttl_sweeper", interval: 30 * time.Millisecond}
	audit := &recordingAudit{}
	sched := NewScheduler([]Worker{w}, lock, audit)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(120 * time.Millisecond)
	sched.Stop()

	if got := atomic.LoadInt64(&w.runCount); got != 0 {
		t.Errorf("worker should not have run while lock contended; got %d", got)
	}
	if rows := audit.snapshot(); len(rows) != 0 {
		t.Errorf("no heartbeat should fire on skipped ticks; got %+v", rows)
	}
}

func TestScheduler_RunErrorEmittedAsAuditButLoopContinues(t *testing.T) {
	w := &fakeWorker{name: "blob_gc", interval: 30 * time.Millisecond, runErr: errors.New("boom")}
	audit := &recordingAudit{}
	sched := NewScheduler([]Worker{w}, NewMemLock(), audit)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(110 * time.Millisecond)
	sched.Stop()

	rows := audit.snapshot()
	if len(rows) < 2 {
		t.Fatalf("expected >= 2 ticks; got %d", len(rows))
	}
	for _, r := range rows {
		if r.Outcome != ossmodel.AuditOutcomeError {
			t.Errorf("error tick should record outcome=error, got %q", r.Outcome)
		}
		if r.Reason == "" {
			t.Errorf("error tick reason should be non-empty")
		}
	}
}

func TestScheduler_DoubleStartRefused(t *testing.T) {
	w := &fakeWorker{name: "ttl_sweeper", interval: time.Hour}
	sched := NewScheduler([]Worker{w}, NewMemLock(), nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("first Start: %v", err)
	}
	defer sched.Stop()
	if err := sched.Start(ctx); err == nil {
		t.Errorf("second Start should error to prevent double scheduling")
	}
}

func TestScheduler_SnapshotBeforeAnyRunReturnsZeros(t *testing.T) {
	w := &fakeWorker{name: "ttl_sweeper", interval: time.Hour}
	sched := NewScheduler([]Worker{w}, NewMemLock(), nil)

	snaps := sched.Snapshot()
	if len(snaps) != 1 {
		t.Fatalf("snapshot len: got %d want 1", len(snaps))
	}
	got := snaps[0]
	if got.Name != "ttl_sweeper" {
		t.Errorf("name: %q", got.Name)
	}
	if got.Interval != time.Hour {
		t.Errorf("interval should pass through Worker.Interval(): %v", got.Interval)
	}
	if !got.LastRunAt.IsZero() {
		t.Errorf("never-run worker should have zero LastRunAt: %v", got.LastRunAt)
	}
	if got.LastOutcome != "" || got.LastError != "" {
		t.Errorf("never-run worker should not surface outcome/error: %+v", got)
	}
	if got.RunCount != 0 || got.ErrorCount != 0 {
		t.Errorf("counters should start at 0: runs=%d errs=%d", got.RunCount, got.ErrorCount)
	}
}

func TestScheduler_SnapshotTracksOutcomeAndCounts(t *testing.T) {
	// Two workers: one always succeeds, one always errors. We
	// run the scheduler long enough for >=1 tick on each, then
	// assert their snapshots reflect outcome / counts independently.
	okW := &fakeWorker{name: "ttl_sweeper", interval: 30 * time.Millisecond}
	failW := &fakeWorker{name: "blob_gc", interval: 30 * time.Millisecond, runErr: errors.New("boom")}
	sched := NewScheduler([]Worker{okW, failW}, NewMemLock(), nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sched.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(110 * time.Millisecond)
	sched.Stop()

	snaps := sched.Snapshot()
	if len(snaps) != 2 {
		t.Fatalf("snapshot len: got %d want 2", len(snaps))
	}
	byName := map[string]WorkerSnapshot{}
	for _, s := range snaps {
		byName[s.Name] = s
	}

	ok := byName["ttl_sweeper"]
	if ok.LastOutcome != ossmodel.AuditOutcomeOK {
		t.Errorf("ok worker outcome: %q", ok.LastOutcome)
	}
	if ok.LastError != "" {
		t.Errorf("ok worker should have empty LastError: %q", ok.LastError)
	}
	if ok.RunCount < 2 {
		t.Errorf("ok worker should have >=2 runs, got %d", ok.RunCount)
	}
	if ok.ErrorCount != 0 {
		t.Errorf("ok worker should have 0 errors, got %d", ok.ErrorCount)
	}
	if ok.LastRunAt.IsZero() {
		t.Errorf("ok worker LastRunAt must be set")
	}

	fail := byName["blob_gc"]
	if fail.LastOutcome != ossmodel.AuditOutcomeError {
		t.Errorf("fail worker outcome: %q", fail.LastOutcome)
	}
	if fail.LastError != "boom" {
		t.Errorf("fail worker LastError: %q", fail.LastError)
	}
	if fail.ErrorCount == 0 || fail.ErrorCount != fail.RunCount {
		t.Errorf("fail worker errors=runs expected; got runs=%d errs=%d",
			fail.RunCount, fail.ErrorCount)
	}
}
