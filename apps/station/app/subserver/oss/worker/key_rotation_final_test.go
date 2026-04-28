package worker

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
)

// rotationFakeMeta tracks reads, writes, and deletes so we can
// assert that the finalizer only clears the keys when the grace
// window has elapsed.
type rotationFakeMeta struct {
	mu       sync.Mutex
	kv       map[string]string
	getErr   error
	delErr   error
	deleted  []string
}

func newRotationFakeMeta() *rotationFakeMeta {
	return &rotationFakeMeta{kv: map[string]string{}}
}

func (m *rotationFakeMeta) Get(_ context.Context, key string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.getErr != nil {
		return "", m.getErr
	}
	return m.kv[key], nil
}

func (m *rotationFakeMeta) SetCapabilityVersion(context.Context, time.Time) (string, error) {
	return "", nil
}

func (m *rotationFakeMeta) Set(_ context.Context, key, value string, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.kv[key] = value
	return nil
}

func (m *rotationFakeMeta) Delete(_ context.Context, keys ...string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.delErr != nil {
		return 0, m.delErr
	}
	var n int64
	for _, k := range keys {
		if _, ok := m.kv[k]; ok {
			delete(m.kv, k)
			n++
			m.deleted = append(m.deleted, k)
		}
	}
	return n, nil
}

func TestKeyRotationFinalizer_NewValidates(t *testing.T) {
	if _, err := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{Audit: &recordingAudit{}}); err == nil {
		t.Errorf("missing Meta should error")
	}
	if _, err := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{Meta: newRotationFakeMeta()}); err == nil {
		t.Errorf("missing Audit should error")
	}
}

func TestKeyRotationFinalizer_NoRotationInFlight(t *testing.T) {
	meta := newRotationFakeMeta()
	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Meta: meta, Audit: audit,
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if len(meta.deleted) != 0 {
		t.Errorf("no keys should be deleted when no rotation is in flight")
	}
	if len(audit.snapshot()) != 0 {
		t.Errorf("no audit rows expected on the no-op path")
	}
}

func TestKeyRotationFinalizer_InsideGraceLeavesAlone(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	rotated := now.Add(-12 * time.Hour) // 12h ago, grace is 24h
	meta := newRotationFakeMeta()
	meta.kv[ossmodel.MetaKeyFederationRotatedAt] = rotated.Format(time.RFC3339Nano)
	meta.kv[ossmodel.MetaKeyFederationPrivKeyPrev] = "prev-priv"
	meta.kv[ossmodel.MetaKeyFederationKIDPrev] = "prev-kid"

	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Meta: meta, Audit: audit,
		Grace: 24 * time.Hour,
		Now:   func() time.Time { return now },
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if _, ok := meta.kv[ossmodel.MetaKeyFederationRotatedAt]; !ok {
		t.Errorf("rotated_at should still be present inside the grace window")
	}
	if _, ok := meta.kv[ossmodel.MetaKeyFederationPrivKeyPrev]; !ok {
		t.Errorf("prev priv key should still be present inside the grace window")
	}
	if len(audit.snapshot()) != 0 {
		t.Errorf("no audit rows expected when grace has not elapsed")
	}
}

func TestKeyRotationFinalizer_GraceElapsedClearsAndAudits(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	rotated := now.Add(-48 * time.Hour) // 48h ago, well past 24h grace
	meta := newRotationFakeMeta()
	meta.kv[ossmodel.MetaKeyFederationRotatedAt] = rotated.Format(time.RFC3339Nano)
	meta.kv[ossmodel.MetaKeyFederationPrivKeyPrev] = "prev-priv"
	meta.kv[ossmodel.MetaKeyFederationKIDPrev] = "prev-kid"

	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Meta: meta, Audit: audit,
		Grace: 24 * time.Hour,
		Now:   func() time.Time { return now },
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	for _, k := range []string{
		ossmodel.MetaKeyFederationRotatedAt,
		ossmodel.MetaKeyFederationPrivKeyPrev,
		ossmodel.MetaKeyFederationKIDPrev,
	} {
		if _, ok := meta.kv[k]; ok {
			t.Errorf("expected %q to be cleared after grace elapsed", k)
		}
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
}

func TestKeyRotationFinalizer_AcceptsRFC3339SecondPrecision(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	rotated := now.Add(-48 * time.Hour)
	meta := newRotationFakeMeta()
	meta.kv[ossmodel.MetaKeyFederationRotatedAt] = rotated.Format(time.RFC3339)
	meta.kv[ossmodel.MetaKeyFederationPrivKeyPrev] = "prev-priv"

	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Meta: meta, Audit: &recordingAudit{},
		Grace: 24 * time.Hour,
		Now:   func() time.Time { return now },
	})
	if err := krf.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if _, ok := meta.kv[ossmodel.MetaKeyFederationPrivKeyPrev]; ok {
		t.Errorf("RFC3339-second timestamp should also trigger finalization")
	}
}

func TestKeyRotationFinalizer_BadTimestampAuditedAndPropagates(t *testing.T) {
	meta := newRotationFakeMeta()
	meta.kv[ossmodel.MetaKeyFederationRotatedAt] = "this-is-not-a-time"
	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Meta: meta, Audit: audit,
	})
	if err := krf.RunOnce(context.Background()); err == nil {
		t.Fatalf("invalid rotated_at timestamp should propagate as an error")
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row, got %+v", rows)
	}
}

func TestKeyRotationFinalizer_DeleteFailureAudited(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	rotated := now.Add(-48 * time.Hour)
	meta := newRotationFakeMeta()
	meta.kv[ossmodel.MetaKeyFederationRotatedAt] = rotated.Format(time.RFC3339Nano)
	meta.delErr = errors.New("constraint violation")

	audit := &recordingAudit{}
	krf, _ := NewKeyRotationFinalizer(KeyRotationFinalizerConfig{
		Meta: meta, Audit: audit,
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
