// KeyRotationFinalizer — clears the previous federation keypair
// once the dual-sign window after a rotation has elapsed.
//
// The key-rotation flow (S13) writes the new keypair into the
// canonical `MetaKeyFederation{Priv,Pub,KID}` rows AND copies the
// outgoing keypair into `MetaKeyFederation{PrivKeyPrev,KIDPrev}`,
// stamping `MetaKeyFederationRotatedAt = now`. During the dual-sign
// window the verifier accepts both the current and the previous
// kid so peers with cached short-lived JWTs (60s TTL) can still
// validate while they refresh capabilities.
//
// Once `now - rotatedAt > FederationRotationGrace` the previous
// keypair is no longer useful — any token signed by it has long
// since expired. The finalizer drops the three `_prev`/`rotated_at`
// rows in one transaction and audits the closure with
// action=key_rotate, reason=rotation_finalized.
//
// The worker tolerates absence (rotation never happened) as a
// no-op; the only failure path that surfaces is a real DB error.
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

// KeyRotationFinalizerConfig configures the finalizer.
type KeyRotationFinalizerConfig struct {
	Meta  ossrepo.MetaRepository
	Audit ossrepo.AuditRepository

	// Grace is the dual-sign window. Defaults to 24h.
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
	if cfg.Meta == nil {
		return nil, errors.New("worker: key_rotation: Meta repo is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("worker: key_rotation: Audit repo is required")
	}
	if cfg.Grace <= 0 {
		cfg.Grace = 24 * time.Hour
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

// RunOnce checks the rotation timestamp and clears the `_prev`
// keypair if the grace window has elapsed.
func (w *KeyRotationFinalizer) RunOnce(ctx context.Context) error {
	rotatedRaw, err := w.cfg.Meta.Get(ctx, ossmodel.MetaKeyFederationRotatedAt)
	if err != nil {
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionKeyRotate,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "rotation_check: " + err.Error(),
		})
		return err
	}
	if rotatedRaw == "" {
		// No rotation in flight. Quiet no-op — the
		// scheduler heartbeat already records the tick.
		return nil
	}
	rotatedAt, err := time.Parse(time.RFC3339Nano, rotatedRaw)
	if err != nil {
		// Try the loose RFC3339 form too — the rotation
		// flow may have stamped a wall-clock string with
		// second precision.
		rotatedAt, err = time.Parse(time.RFC3339, rotatedRaw)
	}
	if err != nil {
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionKeyRotate,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "rotation_parse: " + rotatedRaw,
		})
		return fmt.Errorf("worker: key_rotation: parse rotated_at %q: %w", rotatedRaw, err)
	}

	if w.now().Sub(rotatedAt) < w.cfg.Grace {
		// Still inside the dual-sign window — leave the
		// `_prev` slot in place.
		return nil
	}

	// Grace elapsed. Drop the prev keypair AND the rotated_at
	// stamp so the next rotation starts cleanly. We keep the
	// audit row separate from the delete so the operator log
	// reads as "we cleared the prev key at T".
	deleted, err := w.cfg.Meta.Delete(ctx,
		ossmodel.MetaKeyFederationPrivKeyPrev,
		ossmodel.MetaKeyFederationKIDPrev,
		ossmodel.MetaKeyFederationRotatedAt,
	)
	if err != nil {
		_ = w.cfg.Audit.Append(ctx, ossmodel.Audit{
			Action:  ossmodel.AuditActionKeyRotate,
			Outcome: ossmodel.AuditOutcomeError,
			Reason:  "rotation_clear: " + err.Error(),
		})
		return err
	}
	if err := w.cfg.Audit.Append(ctx, ossmodel.Audit{
		Action:  ossmodel.AuditActionKeyRotate,
		Outcome: ossmodel.AuditOutcomeOK,
		Reason:  fmt.Sprintf("rotation_finalized rotated_at=%s cleared=%d", rotatedAt.UTC().Format(time.RFC3339), deleted),
	}); err != nil {
		log.Warnf(ctx, "[oss-worker] key_rotation audit append failed: %v", err)
	}
	return nil
}
