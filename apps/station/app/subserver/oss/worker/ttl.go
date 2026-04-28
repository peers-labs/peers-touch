// TTLSweeper — periodic worker that soft-deletes files whose
// `expires_at` window has lapsed.
//
// Each tick:
//   1. List up to `BatchSize` live rows with `expires_at < now`,
//      ordered by expires_at ASC so the oldest backlog drains first.
//   2. For each row, call FileRepository.MarkDeleted to flip
//      deleted_at = now atomically. Concurrent races (another
//      worker, or the user-facing DELETE handler) surface as
//      ErrFileAlreadyDeleted; we treat those as benign successes.
//   3. Best-effort:
//        - debit the bucket usage (BucketRepository.AddUsage(-size))
//        - decrement the blob refcount (BlobRepository.Release)
//      A failure on either is logged-and-continued — drift is
//      corrected by the BucketReconciler / BlobGC workers.
//   4. Append one `oss_audit` row per soft-deleted file with
//      action=delete, outcome=ok, reason="ttl".
//
// We deliberately mirror the user-facing DeleteFile invariants
// (mark first, then debit, then release) so the audit graph
// looks the same regardless of who triggered the delete. The
// worker is the only path that records reason="ttl"; manual
// DELETEs use other reason codes (or empty).
package worker

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// TTLSweeperConfig configures a TTLSweeper. Required fields are
// `Files`, `Audit`, and `BackendName`; the others fall back to
// documented defaults.
type TTLSweeperConfig struct {
	// Files is the file repo the sweeper drives. Required.
	Files ossrepo.FileRepository

	// Buckets feeds the bucket-usage debit. nil disables the
	// debit and leaves drift correction entirely to the
	// reconciler (acceptable for tests; not for production).
	Buckets ossrepo.BucketRepository

	// Blobs feeds the refcount release. nil disables the
	// release; same caveat as Buckets — only test setups should
	// pass nil.
	Blobs ossrepo.BlobRepository

	// Audit appends the per-row delete event. Required —
	// auditless TTL deletes would be invisible to operators.
	Audit ossrepo.AuditRepository

	// BackendName is what we pass to BlobRepository.Release
	// (the (backend, key) pair is the blob primary key). Use
	// the active storage backend's driver string ("local",
	// "s3", …). Required.
	BackendName string

	// BatchSize bounds the rows-per-tick. Defaults to 256 — a
	// few hundred rows is small enough to keep the tick under
	// a few seconds on commodity hardware while large enough
	// that the sweeper catches up on a multi-day backlog within
	// a handful of ticks.
	BatchSize int

	// Interval is the cadence between ticks. Defaults to 1h.
	Interval time.Duration

	// Now lets tests inject a clock; production callers leave
	// it nil and get time.Now.
	Now func() time.Time
}

// TTLSweeper implements the Worker interface. Construct with
// NewTTLSweeper rather than the zero value.
type TTLSweeper struct {
	cfg TTLSweeperConfig
	now func() time.Time
}

// NewTTLSweeper validates the config and returns a ready-to-run
// worker. Returns an error when a required dependency is nil.
func NewTTLSweeper(cfg TTLSweeperConfig) (*TTLSweeper, error) {
	if cfg.Files == nil {
		return nil, errors.New("worker: ttl: Files repo is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("worker: ttl: Audit repo is required")
	}
	if cfg.BackendName == "" {
		return nil, errors.New("worker: ttl: BackendName is required")
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 256
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Hour
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &TTLSweeper{cfg: cfg, now: now}, nil
}

func (w *TTLSweeper) Name() string             { return "ttl_sweeper" }
func (w *TTLSweeper) Interval() time.Duration  { return w.cfg.Interval }

// RunOnce sweeps one batch of expired files. Returns the first
// hard error (e.g. ListExpired failed); per-row failures are
// logged and the sweep continues so a single corrupted row
// cannot wedge the worker.
func (w *TTLSweeper) RunOnce(ctx context.Context) error {
	now := w.now()
	rows, err := w.cfg.Files.ListExpired(ctx, now, w.cfg.BatchSize)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	for i := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		w.processOne(ctx, &rows[i], now)
	}
	return nil
}

// processOne runs the mark / debit / release / audit sequence for
// one row. The order matches the user-facing DeleteFile path
// exactly so audit reconciliation does not have to special-case
// TTL deletes.
func (w *TTLSweeper) processOne(ctx context.Context, row *ossmodel.FileMeta, now time.Time) {
	// 1. Mark the row deleted. Lost races surface as
	//    ErrFileAlreadyDeleted — the row is already in the
	//    target state; do not double-debit.
	if err := w.cfg.Files.MarkDeleted(ctx, row.ID, now); err != nil {
		if errors.Is(err, ossrepo.ErrFileAlreadyDeleted) {
			return
		}
		log.Warnf(ctx, "[oss-worker] ttl mark_deleted failed (id=%s key=%s): %v",
			row.ID, row.Key, err)
		return
	}

	// 2. Best-effort bucket debit. Drift here is the
	//    BucketReconciler's job to clean up.
	if w.cfg.Buckets != nil && row.BucketID != "" && row.Size != 0 {
		if err := w.cfg.Buckets.AddUsage(ctx, row.BucketID, -row.Size); err != nil {
			log.Warnf(ctx, "[oss-worker] ttl bucket debit failed (bucket=%s size=%d): %v",
				row.BucketID, row.Size, err)
		}
	}

	// 3. Best-effort blob refcount release. The actual
	//    physical delete is BlobGC's responsibility (after
	//    the configured grace window).
	if w.cfg.Blobs != nil {
		if _, _, err := w.cfg.Blobs.Release(ctx, w.cfg.BackendName, row.Key); err != nil &&
			!errors.Is(err, ossrepo.ErrBlobNotFound) {
			log.Warnf(ctx, "[oss-worker] ttl blob release failed (key=%s): %v",
				row.Key, err)
		}
	}

	// 4. Audit. Worker-driven deletes use reason="ttl" so
	//    operators can grep / alert on background pruning vs
	//    user / admin actions.
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:    ossmodel.AuditActionDelete,
		Outcome:   ossmodel.AuditOutcomeOK,
		Reason:    "ttl",
		FileID:    row.ID,
		FileKey:   row.Key,
		BucketID:  row.BucketID,
		ActorID:   row.OwnerActorID,
		SizeBytes: row.Size,
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] ttl audit append failed (id=%s): %v",
			row.ID, err)
	}
}
