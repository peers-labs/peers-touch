// PeerKeyTrim — drops cached peer-key rows that have not been
// observed in a long time AND are not operator-pinned.
//
// The federation verifier writes a peer-key row on first sighting
// (TOFU) and refreshes `last_seen_at` on every successful verify.
// A row that has been silent for `MaxIdle` is no longer providing
// useful trust state — the next federated request from that peer
// re-TOFUs and gets a fresh row.
//
// Operator-pinned rows are NEVER trimmed: dropping a pinned row
// would silently invalidate the operator's trust decision (next
// TOFU would silently accept whatever key the peer presents).
// Operators must explicitly forget pinned peers via the dashboard.
//
// Each tick performs one bulk DELETE keyed by `pinned = false AND
// last_seen_at < cutoff`. There is no per-row decision branch —
// the predicate is set-shaped and the SQL engine handles it in a
// single statement. Audit row carries the count for observability.
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

// PeerKeyTrimConfig configures the PeerKeyTrim worker.
type PeerKeyTrimConfig struct {
	// Peers is the persistence boundary. Required.
	Peers ossrepo.PeerKeyRepository

	// Audit appends the worker_run heartbeat with the trim
	// count. Required.
	Audit ossrepo.AuditRepository

	// MaxIdle is the silence window after which an unpinned row
	// is eligible for deletion. Defaults to 30 days. Pinned rows
	// are exempt regardless of this value.
	MaxIdle time.Duration

	// Interval is the cadence between ticks. Defaults to 24h.
	Interval time.Duration

	// Now lets tests pin the clock; nil = time.Now.
	Now func() time.Time
}

// PeerKeyTrim implements Worker.
type PeerKeyTrim struct {
	cfg PeerKeyTrimConfig
	now func() time.Time
}

// NewPeerKeyTrim constructs and validates the worker.
func NewPeerKeyTrim(cfg PeerKeyTrimConfig) (*PeerKeyTrim, error) {
	if cfg.Peers == nil {
		return nil, errors.New("worker: peer_key_trim: Peers repo is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("worker: peer_key_trim: Audit repo is required")
	}
	if cfg.MaxIdle <= 0 {
		cfg.MaxIdle = 30 * 24 * time.Hour
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &PeerKeyTrim{cfg: cfg, now: now}, nil
}

func (w *PeerKeyTrim) Name() string            { return "peer_key_trim" }
func (w *PeerKeyTrim) Interval() time.Duration { return w.cfg.Interval }

// RunOnce performs a single bulk trim.
func (w *PeerKeyTrim) RunOnce(ctx context.Context) error {
	cutoff := w.now().Add(-w.cfg.MaxIdle)
	deleted, err := w.cfg.Peers.DeleteUnpinnedOlderThan(ctx, cutoff)
	if err != nil {
		// Surface the failure as an error audit row so an
		// operator monitoring the worker_run feed sees it.
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionWorkerRun,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "peer_key_trim: " + err.Error(),
		})
		return err
	}
	if deleted == 0 {
		// No-op tick — the scheduler heartbeat already
		// records "ran successfully", so we skip the per-tick
		// audit row to keep the log focused on real changes.
		return nil
	}
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:  ossmodel.AuditActionWorkerRun,
		Outcome: ossmodel.AuditOutcomeOK,
		Reason:  fmt.Sprintf("peer_key_trim deleted=%d cutoff=%s", deleted, cutoff.UTC().Format(time.RFC3339)),
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] peer_key_trim audit append failed: %v", err)
	}
	return nil
}
