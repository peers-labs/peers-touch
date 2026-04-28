package worker

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// trimFakeAudit is recordingAudit's richer cousin — Trim is
// controllable so we can exercise both the no-op and "rows
// removed" branches of AuditTrim.
type trimFakeAudit struct {
	mu          sync.Mutex
	rows        []ossmodel.Audit
	trimErr     error
	appendErr   error
	trimCount   int64
	gotCutoff   time.Time
	trimCalled  int
}

func (a *trimFakeAudit) Append(_ context.Context, evt ossmodel.Audit) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.appendErr != nil {
		return a.appendErr
	}
	a.rows = append(a.rows, evt)
	return nil
}
func (a *trimFakeAudit) Query(context.Context, ossrepo.AuditQuery) ([]ossmodel.Audit, int64, error) {
	return nil, 0, nil
}
func (a *trimFakeAudit) Trim(_ context.Context, olderThan time.Time) (int64, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.trimCalled++
	a.gotCutoff = olderThan
	if a.trimErr != nil {
		return 0, a.trimErr
	}
	return a.trimCount, nil
}

func (a *trimFakeAudit) snapshot() []ossmodel.Audit {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]ossmodel.Audit, len(a.rows))
	copy(out, a.rows)
	return out
}

func TestAuditTrim_NewValidates(t *testing.T) {
	if _, err := NewAuditTrim(AuditTrimConfig{}); err == nil {
		t.Errorf("missing Audit should error")
	}
}

func TestAuditTrim_ZeroDeletedQuiet(t *testing.T) {
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	audit := &trimFakeAudit{trimCount: 0}
	at, _ := NewAuditTrim(AuditTrimConfig{
		Audit:     audit,
		Retention: 90 * 24 * time.Hour,
		Now:       func() time.Time { return now },
	})
	if err := at.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if audit.trimCalled != 1 {
		t.Errorf("Trim should be called exactly once per tick (got %d)", audit.trimCalled)
	}
	wantCutoff := now.Add(-90 * 24 * time.Hour)
	if !audit.gotCutoff.Equal(wantCutoff) {
		t.Errorf("cutoff: got %s want %s", audit.gotCutoff, wantCutoff)
	}
	if rows := audit.snapshot(); len(rows) != 0 {
		t.Errorf("zero-delete tick should not emit a worker_run audit row, got %+v", rows)
	}
}

func TestAuditTrim_DeletedAudits(t *testing.T) {
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	audit := &trimFakeAudit{trimCount: 1234}
	at, _ := NewAuditTrim(AuditTrimConfig{
		Audit:     audit,
		Retention: 30 * 24 * time.Hour,
		Now:       func() time.Time { return now },
	})
	if err := at.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	rows := audit.snapshot()
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row after deletion, got %d", len(rows))
	}
	if rows[0].Action != ossmodel.AuditActionWorkerRun {
		t.Errorf("audit action: want worker_run, got %q", rows[0].Action)
	}
	if !strings.Contains(rows[0].Reason, "deleted=1234") {
		t.Errorf("audit reason should include count: %q", rows[0].Reason)
	}
}

func TestAuditTrim_TrimErrorAuditedAndPropagates(t *testing.T) {
	audit := &trimFakeAudit{trimErr: errors.New("disk full")}
	at, _ := NewAuditTrim(AuditTrimConfig{Audit: audit})
	if err := at.RunOnce(context.Background()); err == nil {
		t.Fatalf("trim error should propagate so the scheduler emits an error heartbeat")
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row, got %+v", rows)
	}
}
