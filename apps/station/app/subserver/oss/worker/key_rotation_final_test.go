package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
)

// rotationFakeKeys is a tiny federation.KeyStore that reports a
// rotation in flight when its `prev` slot is populated. Tests
// adjust the GeneratedAt timestamp on prev to drive the
// inside-grace / past-grace branches.
type rotationFakeKeys struct {
	current  *federation.LocalKey
	prev     *federation.LocalKey
	loadErr  error
	clearErr error
	cleared  bool
}

func (k *rotationFakeKeys) Load(_ context.Context, slot string) (*federation.LocalKey, error) {
	if k.loadErr != nil {
		return nil, k.loadErr
	}
	switch slot {
	case federation.SlotCurrent:
		if k.current == nil {
			return nil, federation.ErrNoLocalKey
		}
		cp := *k.current
		return &cp, nil
	case federation.SlotPrev:
		if k.prev == nil {
			return nil, federation.ErrNoLocalKey
		}
		cp := *k.prev
		return &cp, nil
	}
	return nil, errors.New("rotationFakeKeys: bad slot")
}

func (k *rotationFakeKeys) LoadCurrentKid(context.Context) (string, error) {
	if k.current == nil {
		return "", nil
	}
	return k.current.Kid, nil
}

func (k *rotationFakeKeys) PutCurrent(_ context.Context, key *federation.LocalKey) error {
	cp := *key
	k.current = &cp
	return nil
}

func (k *rotationFakeKeys) Rotate(_ context.Context, key *federation.LocalKey) (*federation.RotateResult, error) {
	res := &federation.RotateResult{NewKid: key.Kid, RotatedAt: time.Now()}
	if k.current != nil {
		demoted := *k.current
		k.prev = &demoted
		res.PreviousKid = k.current.Kid
	}
	cp := *key
	k.current = &cp
	return res, nil
}

func (k *rotationFakeKeys) ClearPrev(context.Context) error {
	if k.clearErr != nil {
		return k.clearErr
	}
	k.cleared = true
	k.prev = nil
	return nil
}

// stubLocalKey returns a non-empty *federation.LocalKey with
// the given GeneratedAt; the cryptographic material is
// irrelevant for the finalizer's behaviour.
func stubLocalKey(kid string, generatedAt time.Time) *federation.LocalKey {
	return &federation.LocalKey{
		Kid:         kid,
		PrivPEM:     "PRIV",
		PubPEM:      "PUB",
		GeneratedAt: generatedAt,
	}
}

func TestKeyRotationFinalizer_NewValidates(t *testing.T) {
	if _, err := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{Audit: &recordingAudit{}}); err == nil {
		t.Errorf("missing Keys should error")
	}
	if _, err := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{Keys: &rotationFakeKeys{}}); err == nil {
		t.Errorf("missing Audit should error")
	}
}

func TestKeyRotationFinalizer_NoRotationInFlight(t *testing.T) {
	keys := &rotationFakeKeys{}
	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys: keys, Audit: audit,
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if keys.cleared {
		t.Errorf("no clear expected when prev slot is empty")
	}
	if len(audit.snapshot()) != 0 {
		t.Errorf("no audit rows expected on the no-op path")
	}
}

func TestKeyRotationFinalizer_InsideGraceLeavesAlone(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	keys := &rotationFakeKeys{prev: stubLocalKey("prev-kid", now.Add(-12*time.Hour))}

	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys: keys, Audit: audit,
		Grace: 24 * time.Hour,
		Now:   func() time.Time { return now },
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if keys.cleared {
		t.Errorf("prev slot must be preserved inside the grace window")
	}
	if keys.prev == nil {
		t.Errorf("prev slot must still be populated inside the grace window")
	}
	if len(audit.snapshot()) != 0 {
		t.Errorf("no audit rows expected when grace has not elapsed")
	}
}

func TestKeyRotationFinalizer_GraceElapsedClearsAndAudits(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	keys := &rotationFakeKeys{prev: stubLocalKey("prev-kid", now.Add(-48*time.Hour))}

	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys: keys, Audit: audit,
		Grace: 24 * time.Hour,
		Now:   func() time.Time { return now },
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if !keys.cleared || keys.prev != nil {
		t.Errorf("prev slot should be cleared after the grace window")
	}
	rows := audit.snapshot()
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	if rows[0].Action != ossmodel.AuditActionKeyRotate {
		t.Errorf("audit action: want %q, got %q", ossmodel.AuditActionKeyRotate, rows[0].Action)
	}
	if !strings.Contains(rows[0].Reason, "rotation_finalized") {
		t.Errorf("audit reason should mention finalization: %q", rows[0].Reason)
	}
	if !strings.Contains(rows[0].Reason, "prev-kid") {
		t.Errorf("audit reason should include the prev kid: %q", rows[0].Reason)
	}
}

func TestKeyRotationFinalizer_LoadFailureAuditedAndPropagates(t *testing.T) {
	keys := &rotationFakeKeys{loadErr: errors.New("db dialer broken")}
	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys: keys, Audit: audit,
	})
	if err := krf.RunOnce(context.Background()); err == nil {
		t.Fatalf("load failure should propagate")
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row, got %+v", rows)
	}
}

func TestKeyRotationFinalizer_DeleteFailureAudited(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	keys := &rotationFakeKeys{
		prev:     stubLocalKey("prev-kid", now.Add(-48*time.Hour)),
		clearErr: errors.New("constraint violation"),
	}
	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Keys: keys, Audit: audit,
		Grace: 24 * time.Hour,
		Now:   func() time.Time { return now },
	})
	if err := krf.RunOnce(context.Background()); err == nil {
		t.Fatalf("delete failure should propagate")
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row, got %+v", rows)
	}
}
