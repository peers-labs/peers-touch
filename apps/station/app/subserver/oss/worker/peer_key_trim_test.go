package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
)

// peerTrimFake is a tiny PeerKeyRepository tailored to PeerKeyTrim's
// surface — only DeleteUnpinnedOlderThan needs to do real work; the
// other methods are unused stubs.
type peerTrimFake struct {
	gotCutoff time.Time
	deleted   int64
	err       error
}

func (p *peerTrimFake) DeleteUnpinnedOlderThan(_ context.Context, olderThan time.Time) (int64, error) {
	p.gotCutoff = olderThan
	if p.err != nil {
		return 0, p.err
	}
	return p.deleted, nil
}

// Stub methods.
func (p *peerTrimFake) LoadLocalKey(context.Context) (string, string, string, error) {
	return "", "", "", nil
}
func (p *peerTrimFake) SaveLocalKey(context.Context, string, string, string) error { return nil }
func (p *peerTrimFake) GetCurrentKID(context.Context) (string, error)              { return "", nil }
func (p *peerTrimFake) GetPeer(context.Context, string) (*ossmodel.PeerKey, error) { return nil, nil }
func (p *peerTrimFake) UpsertTOFU(context.Context, ossmodel.PeerKey) error          { return nil }
func (p *peerTrimFake) TouchLastSeen(context.Context, string, time.Time)            {}

func TestPeerKeyTrim_NewValidates(t *testing.T) {
	if _, err := NewPeerKeyTrim(PeerKeyTrimConfig{Audit: &recordingAudit{}}); err == nil {
		t.Errorf("missing Peers should error")
	}
	if _, err := NewPeerKeyTrim(PeerKeyTrimConfig{Peers: &peerTrimFake{}}); err == nil {
		t.Errorf("missing Audit should error")
	}
}

func TestPeerKeyTrim_HappyPathAuditsCount(t *testing.T) {
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	peers := &peerTrimFake{deleted: 7}
	audit := &recordingAudit{}
	trim, err := NewPeerKeyTrim(PeerKeyTrimConfig{
		Peers:   peers,
		Audit:   audit,
		MaxIdle: 30 * 24 * time.Hour,
		Now:     func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewPeerKeyTrim: %v", err)
	}
	if err := trim.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	wantCutoff := now.Add(-30 * 24 * time.Hour)
	if !peers.gotCutoff.Equal(wantCutoff) {
		t.Errorf("cutoff: got %s, want %s", peers.gotCutoff, wantCutoff)
	}

	rows := audit.snapshot()
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	if rows[0].Action != ossmodel.AuditActionWorkerRun {
		t.Errorf("audit action: got %q", rows[0].Action)
	}
	if !strings.Contains(rows[0].Reason, "deleted=7") {
		t.Errorf("audit reason should include count: %q", rows[0].Reason)
	}
}

func TestPeerKeyTrim_NoOpQuietAudits(t *testing.T) {
	// When nothing was deleted we want zero audit rows beyond
	// the scheduler's own heartbeat (handled elsewhere).
	peers := &peerTrimFake{deleted: 0}
	audit := &recordingAudit{}
	trim, _ := NewPeerKeyTrim(PeerKeyTrimConfig{Peers: peers, Audit: audit})
	if err := trim.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if len(audit.snapshot()) != 0 {
		t.Errorf("zero-delete tick should not emit a worker audit row")
	}
}

func TestPeerKeyTrim_RepoErrorAuditedAndPropagates(t *testing.T) {
	peers := &peerTrimFake{err: errors.New("db locked")}
	audit := &recordingAudit{}
	trim, _ := NewPeerKeyTrim(PeerKeyTrimConfig{Peers: peers, Audit: audit})
	if err := trim.RunOnce(context.Background()); err == nil {
		t.Fatalf("repo error should propagate so the scheduler emits an error heartbeat")
	}
	rows := audit.snapshot()
	if len(rows) != 1 || rows[0].Outcome != ossmodel.AuditOutcomeError {
		t.Errorf("expected one error audit row, got %+v", rows)
	}
}
