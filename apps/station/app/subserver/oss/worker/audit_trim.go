// AuditTrim — periodically deletes oss_audit rows older than the
// configured retention window.
//
// The audit log is append-only by design; the only path that
// removes rows is this worker. Bounding the retention window
// matters for two reasons:
//
//   - Storage. A busy household generates 100k+ audit rows a week
//     (every GET / federation verify / worker tick). Holding it
//     forever turns into a multi-GB Postgres table that operators
//     never query.
//   - Compliance. Operators want a documented "we keep 90 days of
//     access logs" policy. The retention knob is the single seam
//     for that decision.
//
// Each tick:
//
//  1. Compute cutoff = now - Retention.
//  2. Call AuditRepository.Trim(cutoff). This is one bulk DELETE.
//  3. If anything was deleted, append a single
//     action=worker_run, reason=audit_trim N=… row so the
//     trim itself is auditable.
//
// We deliberately keep the deletion path inside `audit_repo.Trim`
// rather than re-implementing the SQL here — the audit repo is the
// authoritative boundary on the table.
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

// AuditTrimConfig configures the AuditTrim worker.
type AuditTrimConfig struct {
	// Audit owns both the bulk-delete primitive and the audit
	// row we append after a successful trim. Required.
	Audit ossrepo.AuditRepository

	// Retention is the keep-alive window. Defaults to 90 days.
	Retention time.Duration

	// Interval is the cadence between ticks. Defaults to 24h.
	Interval time.Duration

	// Now lets tests pin the clock; nil = time.Now.
	Now func() time.Time
}

// AuditTrim implements Worker.
type AuditTrim struct {
	cfg AuditTrimConfig
	now func() time.Time
}

// NewAuditTrim constructs and validates the worker.
func NewAuditTrim(cfg AuditTrimConfig) (*AuditTrim, error) {
	if cfg.Audit == nil {
		return nil, errors.New("worker: audit_trim: Audit repo is required")
	}
	if cfg.Retention <= 0 {
		cfg.Retention = 90 * 24 * time.Hour
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &AuditTrim{cfg: cfg, now: now}, nil
}

func (w *AuditTrim) Name() string            { return "audit_trim" }
func (w *AuditTrim) Interval() time.Duration { return w.cfg.Interval }

// RunOnce performs a single bulk trim. Returns the underlying
// error so the scheduler heartbeat surfaces it; per-row failures
// are not a concept here (the DELETE is set-shaped).
func (w *AuditTrim) RunOnce(ctx context.Context) error {
	cutoff := w.now().Add(-w.cfg.Retention)
	deleted, err := w.cfg.Audit.Trim(ctx, cutoff)
	if err != nil {
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionWorkerRun,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "audit_trim: " + err.Error(),
		})
		return err
	}
	if deleted == 0 {
		// Steady-state quiet — the scheduler heartbeat
		// already records the tick.
		return nil
	}
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:  ossmodel.AuditActionWorkerRun,
		Outcome: ossmodel.AuditOutcomeOK,
		Reason:  fmt.Sprintf("audit_trim deleted=%d cutoff=%s", deleted, cutoff.UTC().Format(time.RFC3339)),
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] audit_trim audit append failed: %v", err)
	}
	return nil
}
