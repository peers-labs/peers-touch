// BucketReconciler — corrects accumulated drift between
// `oss_buckets.used_bytes / object_count` and the authoritative
// SUM/COUNT over live `oss_files`.
//
// The user-facing upload / delete / TTL / admin paths all use
// `BucketRepository.AddUsage(±delta)` so the in-flight quota check
// stays atomic. That works for steady-state but cannot self-heal
// drift — every transient failure on the debit side leaves a few
// bytes off in the cached counter. Over weeks of operation a busy
// bucket could end up several MiB off.
//
// The reconciler runs once a day (configurable). For each bucket it:
//
//	1. Recomputes (sum_bytes, count) from oss_files where deleted_at IS NULL.
//	2. If the count differs at all OR the byte-drift exceeds the
//	   per-mille threshold, `BucketRepository.SetUsage(sum, count)`.
//	3. Audits the correction with action=worker_run, reason=reconcile_*.
//	4. Skips and logs if either query fails.
//
// We deliberately do not mutate quota policy here — the reconciler
// reports reality, not policy. A bucket whose real usage exceeds the
// stale quota becomes operator-visible via the dashboard's
// "over-quota" surface (S15) without the worker silently widening
// the limit.
package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// BucketReconcilerConfig configures the reconciler. Required:
// `Buckets`, `Files`, `Audit`. Tunables fall back to documented
// defaults.
type BucketReconcilerConfig struct {
	Buckets ossrepo.BucketRepository
	Files   ossrepo.FileRepository
	Audit   ossrepo.AuditRepository

	// Interval is the cadence between full sweeps. Defaults to
	// 24h. Tests pin a tiny value via `WithInterval` after
	// constructor.
	Interval time.Duration

	// DriftPermille is the threshold (parts of 1000) under which
	// the worker considers byte drift "acceptable" and skips the
	// rewrite. 0 falls back to 10 (= 1%). The count predicate is
	// independent — any count drift is fixed unconditionally.
	DriftPermille int

	// Now lets tests pin the clock; nil = time.Now.
	Now func() time.Time
}

// BucketReconciler implements Worker.
type BucketReconciler struct {
	cfg BucketReconcilerConfig
	now func() time.Time
}

// NewBucketReconciler constructs and validates the reconciler.
func NewBucketReconciler(cfg BucketReconcilerConfig) (*BucketReconciler, error) {
	if cfg.Buckets == nil {
		return nil, errors.New("worker: reconcile: Buckets repo is required")
	}
	if cfg.Files == nil {
		return nil, errors.New("worker: reconcile: Files repo is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("worker: reconcile: Audit repo is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	if cfg.DriftPermille <= 0 {
		cfg.DriftPermille = 10
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &BucketReconciler{cfg: cfg, now: now}, nil
}

func (w *BucketReconciler) Name() string            { return "bucket_reconcile" }
func (w *BucketReconciler) Interval() time.Duration { return w.cfg.Interval }

// RunOnce sweeps every bucket once. We deliberately keep the per-tick
// cost proportional to the bucket count rather than the file count:
// the SUM query is one statement per bucket, and most buckets carry
// little drift (or none).
func (w *BucketReconciler) RunOnce(ctx context.Context) error {
	rows, err := w.cfg.Buckets.ListAll(ctx)
	if err != nil {
		return err
	}
	for i := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		w.processOne(ctx, &rows[i])
	}
	return nil
}

// processOne handles a single bucket. Errors are audited but never
// halt the sweep — a bad single bucket must not wedge the worker.
func (w *BucketReconciler) processOne(ctx context.Context, b *ossmodel.Bucket) {
	sumBytes, count, err := w.cfg.Files.SumByBucket(ctx, b.ID)
	if err != nil {
		log.Warnf(ctx, "[oss-worker] reconcile sum failed bucket=%s: %v", b.ID, err)
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:    ossmodel.AuditActionWorkerRun,
			Outcome:   ossmodel.AuditOutcomeError,
			Reason:    "reconcile_sum: " + err.Error(),
			BucketID:  b.ID,
			SizeBytes: 0,
		})
		return
	}

	// Decide whether to rewrite. The count predicate is exact
	// (counts are integers, any drift is unambiguous); the byte
	// predicate uses the per-mille threshold so a few stray bytes
	// from a race do not churn the row daily.
	countDrift := count != b.ObjectCount
	byteDrift := abs64(sumBytes-b.UsedBytes) > acceptableByteDrift(b.UsedBytes, w.cfg.DriftPermille)
	if !countDrift && !byteDrift {
		return
	}

	if err := w.cfg.Buckets.SetUsage(ctx, b.ID, sumBytes, count); err != nil {
		log.Warnf(ctx, "[oss-worker] reconcile setUsage failed bucket=%s: %v", b.ID, err)
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:    ossmodel.AuditActionWorkerRun,
			Outcome:   ossmodel.AuditOutcomeError,
			Reason:    "reconcile_set: " + err.Error(),
			BucketID:  b.ID,
			SizeBytes: sumBytes,
		})
		return
	}

	reason := fmt.Sprintf("reconcile_drift bytes=%d→%d count=%d→%d",
		b.UsedBytes, sumBytes, b.ObjectCount, count)
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:    ossmodel.AuditActionWorkerRun,
		Outcome:   ossmodel.AuditOutcomeOK,
		Reason:    reason,
		BucketID:  b.ID,
		SizeBytes: sumBytes,
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] reconcile audit append failed bucket=%s: %v", b.ID, err)
	}
}

// acceptableByteDrift returns the maximum byte difference the
// reconciler tolerates against `cached`. Always at least 1 byte so
// a brand-new (empty) bucket whose reality is also empty does not
// trip the rewrite.
func acceptableByteDrift(cached int64, permille int) int64 {
	if cached <= 0 {
		return 0
	}
	tol := cached * int64(permille) / 1000
	if tol < 1 {
		tol = 1
	}
	return tol
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}
