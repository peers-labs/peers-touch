// KeyRotationFinalizer — clears the previous federation keypair
// once the dual-sign window after a rotation has elapsed.
//
// Rotation is owned by the framework: `auth/federation`'s
// KeyStore atomically demotes the existing `current` row to
// `prev` and writes the new keypair into `current`. During the
// dual-sign window the verifier MAY accept tokens signed by
// either the current or the previous kid so peers with cached
// short-lived JWTs can still validate while they refresh
// capabilities.
//
// Once the wall-clock distance between the prev row's rotation
// timestamp and now exceeds `Grace`, the previous keypair is
// no longer useful — any token signed by it has long since
// expired. The finalizer drops the `prev` row and audits the
// closure with action=key_rotate, reason=rotation_finalized.
//
// The worker tolerates absence (no rotation in flight) as a
// no-op; the only failure path that surfaces is a real DB error.
package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// KeyRotationFinalizerConfig configures the finalizer.
type KeyRotationFinalizerConfig struct {
	// Keys is the framework KeyStore that owns the local
	// signing keypair (`auth_local_keys`). Required. The
	// finalizer reads `prev` and clears it once Grace elapses.
	Keys federation.KeyStore

	// Audit emits the operator-facing closure record. Required.
	Audit ossrepo.AuditRepository

	// Grace is the dual-sign window. Defaults to
	// federation.DefaultDualSignGrace (24h).
	Grace time.Duration

	// Interval is the cadence between ticks. Defaults to 1h —
	// the finalizer is intentionally chatty so a rotation does
	// not sit half-finished for a day.
	Interval time.Duration

	Now func() time.Time
}

// KeyRotationFinalizer implements Worker.
type KeyRotationFinalizer struct {
	cfg KeyRotationFinalizerConfig
	now func() time.Time
}

// NewKeyRotationFinalizer constructs and validates the finalizer.
func NewKeyRotationFinalizer(cfg KeyRotationFinalizerConfig) (*KeyRotationFinalizer, error) {
	if cfg.Keys == nil {
		return nil, errors.New("worker: key_rotation: Keys store is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("worker: key_rotation: Audit repo is required")
	}
	if cfg.Grace <= 0 {
		cfg.Grace = federation.DefaultDualSignGrace
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Hour
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &KeyRotationFinalizer{cfg: cfg, now: now}, nil
}

func (w *KeyRotationFinalizer) Name() string            { return "key_rotation_finalizer" }
func (w *KeyRotationFinalizer) Interval() time.Duration { return w.cfg.Interval }

// RunOnce inspects the prev slot and clears it if the grace
// window has elapsed.
func (w *KeyRotationFinalizer) RunOnce(ctx context.Context) error {
	prev, err := w.cfg.Keys.Load(ctx, federation.SlotPrev)
	if err != nil {
		if errors.Is(err, federation.ErrNoLocalKey) {
			// No rotation in flight. Quiet no-op — the
			// scheduler heartbeat already records the tick.
			return nil
		}
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionKeyRotate,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "rotation_check: " + err.Error(),
		})
		return err
	}

	cutoff := w.now().Add(-w.cfg.Grace)
	if prev.UpdatedAt.IsZero() || prev.UpdatedAt.After(cutoff) {
		// Still inside the dual-sign window — leave the
		// `prev` slot in place.
		return nil
	}

	cleared, err := w.cfg.Keys.ClearPrev(
		ctx,
		prev.Kid,
		prev.UpdatedAt,
	)
	if err != nil {
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionKeyRotate,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "rotation_clear: " + err.Error(),
		})
		return err
	}
	if !cleared {
		return nil
	}
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:  ossmodel.AuditActionKeyRotate,
		Outcome: ossmodel.AuditOutcomeOK,
		Reason: fmt.Sprintf("rotation_finalized prev_kid=%s prev_rotated_at=%s",
			prev.Kid, prev.UpdatedAt.UTC().Format(time.RFC3339)),
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] key_rotation audit append failed: %v", err)
	}
	return nil
}
