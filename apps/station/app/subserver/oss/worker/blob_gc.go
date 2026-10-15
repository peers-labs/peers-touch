// BlobGC — physically removes orphaned blobs whose refcount has
// been zero for longer than the configured grace window.
//
// The grace window is the safety belt against the
// "delete-then-immediate-reupload" race: a user uploads bytes,
// deletes them, then re-uploads the same content. Without grace,
// the GC would race between the soft-delete (refcount→0) and the
// re-upload (refcount→1). Generation staging makes that race safe;
// the grace still avoids unnecessary physical churn.
//
// Each tick:
//  1. List up to BatchSize blobs with `ref_count = 0` and
//     `last_seen_at < now - grace`.
//  2. For each, call `Backend.Delete(key)` to remove the bytes.
//     A backend miss (already gone) is treated as success — the
//     goal is "no row, no bytes", not "exactly one delete".
//  3. Drop the `oss_blobs` row via `BlobRepository.Delete`.
//  4. Append one `oss_audit` row per cleaned blob with
//     action=blob_gc, outcome=ok, reason="ref_zero".
package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// BlobGCConfig configures a BlobGC worker.
type BlobGCConfig struct {
	// Blobs is the persistence boundary. Required.
	Blobs ossrepo.BlobRepository

	// Backend deletes the physical bytes. Required.
	Backend storage.Backend

	// Audit appends per-blob removal events. Required —
	// silent garbage collection is an operator nightmare.
	Audit ossrepo.AuditRepository

	// BackendName matches what the upload writer / blob repo
	// use as the (backend, key) primary key. We only emit
	// audit rows that match Blob.Backend == BackendName so a
	// multi-backend deployment does not accidentally GC
	// another backend's blobs through this worker.
	BackendName string

	// Grace is the minimum age (since LastSeenAt dropped to
	// zero) before a blob is eligible for physical delete.
	// Defaults to 24h.
	Grace time.Duration

	// BatchSize bounds the rows-per-tick. Defaults to 256.
	BatchSize int

	// Interval is the cadence between ticks. Defaults to 1h.
	Interval time.Duration

	// Now lets tests inject a clock; nil = time.Now.
	Now func() time.Time
}

// BlobGC implements the Worker interface.
type BlobGC struct {
	cfg BlobGCConfig
	now func() time.Time
}

// NewBlobGC validates the config and returns a ready-to-run
// worker.
func NewBlobGC(cfg BlobGCConfig) (*BlobGC, error) {
	if cfg.Blobs == nil {
		return nil, errors.New("worker: blob_gc: Blobs repo is required")
	}
	if cfg.Backend == nil {
		return nil, errors.New("worker: blob_gc: Backend is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("worker: blob_gc: Audit repo is required")
	}
	if cfg.BackendName == "" {
		return nil, errors.New("worker: blob_gc: BackendName is required")
	}
	if cfg.Grace <= 0 {
		cfg.Grace = 24 * time.Hour
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
	return &BlobGC{cfg: cfg, now: now}, nil
}

func (w *BlobGC) Name() string            { return "blob_gc" }
func (w *BlobGC) Interval() time.Duration { return w.cfg.Interval }

// RunOnce sweeps one batch of orphaned blobs.
func (w *BlobGC) RunOnce(ctx context.Context) error {
	lease, ok := LeaseAuthorityFromContext(ctx)
	if !ok ||
		lease.WorkerName != w.Name() ||
		lease.OwnerNodePeerID == "" ||
		lease.OwnerIncarnation == "" ||
		lease.FencingToken == 0 {
		return errors.New("worker: blob_gc: fenced lease authority is required")
	}
	cutoff := w.now().Add(-w.cfg.Grace)
	rows, err := w.cfg.Blobs.ListGCCandidates(ctx, cutoff, w.cfg.BatchSize)
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
		// Defensive: ListGCCandidates does not filter by
		// backend (the table may be shared across drivers
		// when a station migrates), so we double-check here.
		if rows[i].Backend != w.cfg.BackendName {
			continue
		}
		w.processOne(ctx, &rows[i], cutoff, lease)
	}
	return nil
}

func (w *BlobGC) processOne(
	ctx context.Context,
	b *ossmodel.Blob,
	cutoff time.Time,
	lease LeaseAuthority,
) {
	// 1. Claim the exact immutable generation while revalidating
	// zero references and the current worker authority.
	claim, err := w.cfg.Blobs.ClaimGC(
		ctx,
		*b,
		cutoff,
		ossrepo.BlobGCAuthority{
			WorkerName:       lease.WorkerName,
			OwnerNodePeerID:  lease.OwnerNodePeerID,
			OwnerIncarnation: lease.OwnerIncarnation,
			FencingToken:     lease.FencingToken,
		},
	)
	if err != nil {
		if !errors.Is(err, ossrepo.ErrBlobGCClaimStale) {
			log.Warnf(ctx, "[oss-worker] blob_gc claim failed (key=%s generation=%d): %v",
				b.Key, b.Generation, err)
		}
		return
	}

	// 2. Physically delete only the claimed generation bytes. Both LocalBackend and
	//    S3Backend return nil for a missing key (idempotent),
	//    so any non-nil error is a real backend failure
	//    worth surfacing.
	if err := w.cfg.Backend.Delete(ctx, claim.StorageKey); err != nil {
		log.Warnf(ctx, "[oss-worker] blob_gc backend.Delete failed (key=%s generation=%d): %v",
			b.Key, claim.Generation, err)
		// Surface the failure as an audit row so operators
		// can correlate with backend health.
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:    ossmodel.AuditActionBlobGC,
			Outcome:   ossmodel.AuditOutcomeError,
			Reason:    fmt.Sprintf("backend_delete generation=%d: %v", claim.Generation, err),
			FileKey:   b.Key,
			SizeBytes: b.Size,
		})
		return
	}

	// 3. Complete only if the generation and fencing authority are
	// still current. A replacement upload advances generation and
	// makes this completion stale by construction.
	if err := w.cfg.Blobs.CompleteGC(ctx, *claim); err != nil {
		log.Warnf(ctx, "[oss-worker] blob_gc completion rejected (key=%s generation=%d): %v",
			b.Key, claim.Generation, err)
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:    ossmodel.AuditActionBlobGC,
			Outcome:   ossmodel.AuditOutcomeError,
			Reason:    fmt.Sprintf("stale_completion generation=%d: %v", claim.Generation, err),
			FileKey:   b.Key,
			SizeBytes: b.Size,
		})
		return
	}

	// 4. Success audit.
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:    ossmodel.AuditActionBlobGC,
		Outcome:   ossmodel.AuditOutcomeOK,
		Reason:    "ref_zero",
		FileKey:   b.Key,
		SizeBytes: b.Size,
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] blob_gc audit append failed (key=%s): %v",
			b.Key, err)
	}
}
