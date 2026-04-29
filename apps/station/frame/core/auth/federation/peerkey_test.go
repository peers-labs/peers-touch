package federation

import (
	"context"
	"errors"
	"testing"
	"time"
)

func newTestPeerKey(t *testing.T, station, kid string) PeerKey {
	t.Helper()
	k, err := MintLocalKey(time.Now())
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if kid != "" {
		// Override the kid so tests can reason about specific
		// drift scenarios. The PEM doesn't actually have to
		// derive to this kid because UpsertTOFU does not
		// re-validate; only the verifier does.
		return PeerKey{StationID: station, Kid: kid, PubPEM: k.PubPEM}
	}
	return PeerKey{StationID: station, Kid: k.Kid, PubPEM: k.PubPEM}
}

func TestPeerKey_FirstSightingInsertsRow(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	in := newTestPeerKey(t, "peer-A", "")
	if err := s.UpsertTOFU(context.Background(), in); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	row, err := s.Get(context.Background(), "peer-A")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if row == nil || row.Kid != in.Kid {
		t.Fatalf("expected row with kid=%q, got %+v", in.Kid, row)
	}
	if row.FirstSeenAt.IsZero() || row.LastSeenAt.IsZero() {
		t.Errorf("expected FirstSeenAt/LastSeenAt to be set")
	}
	if row.Pinned {
		t.Errorf("expected fresh row to be unpinned")
	}
}

func TestPeerKey_GetUnknownReturnsNilNoError(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	row, err := s.Get(context.Background(), "absent")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if row != nil {
		t.Fatalf("expected nil row, got %+v", row)
	}
}

func TestPeerKey_RepeatedSameKidAdvancesLastSeen(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	in := newTestPeerKey(t, "peer-A", "")
	if err := s.UpsertTOFU(context.Background(), in); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	first, _ := s.Get(context.Background(), "peer-A")

	// Sleep so LastSeenAt actually moves.
	time.Sleep(2 * time.Millisecond)

	if err := s.UpsertTOFU(context.Background(), in); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	second, _ := s.Get(context.Background(), "peer-A")
	if !second.LastSeenAt.After(first.LastSeenAt) {
		t.Errorf("expected LastSeenAt to advance: first=%v second=%v",
			first.LastSeenAt, second.LastSeenAt)
	}
}

func TestPeerKey_UnpinnedKidMismatchRejects(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	first := newTestPeerKey(t, "peer-A", "old-kid")
	if err := s.UpsertTOFU(context.Background(), first); err != nil {
		t.Fatalf("first: %v", err)
	}
	second := newTestPeerKey(t, "peer-A", "new-kid")
	err := s.UpsertTOFU(context.Background(), second)
	if !errors.Is(err, ErrPeerKeyMismatch) {
		t.Fatalf("expected ErrPeerKeyMismatch, got %v", err)
	}
}

func TestPeerKey_PinnedKidMismatchRejectsWithDistinctError(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	first := newTestPeerKey(t, "peer-A", "old-kid")
	if err := s.UpsertTOFU(context.Background(), first); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := s.Pin(context.Background(), "peer-A", "did:test:admin", time.Now()); err != nil {
		t.Fatalf("pin: %v", err)
	}
	second := newTestPeerKey(t, "peer-A", "new-kid")
	err := s.UpsertTOFU(context.Background(), second)
	if !errors.Is(err, ErrPinnedKeyMismatch) {
		t.Fatalf("expected ErrPinnedKeyMismatch, got %v", err)
	}
}

func TestPeerKey_PinPersistsActor(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	if err := s.UpsertTOFU(context.Background(), newTestPeerKey(t, "peer-A", "")); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	at := time.Now()
	if err := s.Pin(context.Background(), "peer-A", "did:test:alice", at); err != nil {
		t.Fatalf("pin: %v", err)
	}
	row, _ := s.Get(context.Background(), "peer-A")
	if !row.Pinned {
		t.Errorf("expected pinned=true")
	}
	if row.PinnedByActor != "did:test:alice" {
		t.Errorf("PinnedByActor: got %q", row.PinnedByActor)
	}
	if row.PinnedAt == nil || !row.PinnedAt.Equal(at) {
		t.Errorf("PinnedAt: got %v want %v", row.PinnedAt, at)
	}
}

func TestPeerKey_PinUnknownReturnsError(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	err := s.Pin(context.Background(), "peer-X", "did:test:alice", time.Now())
	if !errors.Is(err, ErrUnknownPeer) {
		t.Errorf("expected ErrUnknownPeer, got %v", err)
	}
}

func TestPeerKey_UnpinIsIdempotent(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	if err := s.Unpin(context.Background(), "peer-X"); err != nil {
		t.Fatalf("unpin missing: %v", err)
	}
	if err := s.UpsertTOFU(context.Background(), newTestPeerKey(t, "peer-A", "")); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := s.Pin(context.Background(), "peer-A", "did:test:alice", time.Now()); err != nil {
		t.Fatalf("pin: %v", err)
	}
	if err := s.Unpin(context.Background(), "peer-A"); err != nil {
		t.Fatalf("unpin: %v", err)
	}
	row, _ := s.Get(context.Background(), "peer-A")
	if row.Pinned {
		t.Errorf("expected unpinned after unpin")
	}
	if row.PinnedAt != nil {
		t.Errorf("expected PinnedAt nil after unpin")
	}
}

func TestPeerKey_ForgetAllowsReTOFU(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	first := newTestPeerKey(t, "peer-A", "old-kid")
	if err := s.UpsertTOFU(context.Background(), first); err != nil {
		t.Fatalf("first: %v", err)
	}
	n, err := s.Forget(context.Background(), "peer-A")
	if err != nil || n != 1 {
		t.Fatalf("forget: n=%d err=%v", n, err)
	}
	second := newTestPeerKey(t, "peer-A", "new-kid")
	if err := s.UpsertTOFU(context.Background(), second); err != nil {
		t.Errorf("post-forget upsert should succeed: %v", err)
	}
}

func TestPeerKey_ForgetMissingReturnsZero(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	n, err := s.Forget(context.Background(), "peer-X")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if n != 0 {
		t.Errorf("expected 0, got %d", n)
	}
}

func TestPeerKey_DeleteUnpinnedOlderThan_KeepsPinned(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	now := time.Now()
	old := newTestPeerKey(t, "peer-old", "")
	old.LastSeenAt = now.Add(-2 * time.Hour)
	old.FirstSeenAt = old.LastSeenAt
	pinnedOld := newTestPeerKey(t, "peer-pinned", "")
	pinnedOld.LastSeenAt = now.Add(-2 * time.Hour)
	pinnedOld.FirstSeenAt = pinnedOld.LastSeenAt
	fresh := newTestPeerKey(t, "peer-fresh", "")
	fresh.LastSeenAt = now
	fresh.FirstSeenAt = now

	for _, in := range []PeerKey{old, pinnedOld, fresh} {
		if err := s.UpsertTOFU(context.Background(), in); err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}
	if err := s.Pin(context.Background(), "peer-pinned", "did:test:alice", now); err != nil {
		t.Fatalf("pin: %v", err)
	}

	n, err := s.DeleteUnpinnedOlderThan(context.Background(), now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 trimmed, got %d", n)
	}

	if row, _ := s.Get(context.Background(), "peer-old"); row != nil {
		t.Errorf("peer-old should have been trimmed")
	}
	if row, _ := s.Get(context.Background(), "peer-pinned"); row == nil {
		t.Errorf("peer-pinned should have been kept")
	}
	if row, _ := s.Get(context.Background(), "peer-fresh"); row == nil {
		t.Errorf("peer-fresh should have been kept")
	}
}

func TestPeerKey_DeleteUnpinnedOlderThan_ZeroIsNoop(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	if err := s.UpsertTOFU(context.Background(), newTestPeerKey(t, "peer-A", "")); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	n, err := s.DeleteUnpinnedOlderThan(context.Background(), time.Time{})
	if err != nil {
		t.Fatalf("trim zero: %v", err)
	}
	if n != 0 {
		t.Errorf("expected zero-cutoff to be a no-op, got %d", n)
	}
}

func TestPeerKey_ListReturnsAllRows(t *testing.T) {
	s := NewInMemoryPeerKeyStore()
	for _, name := range []string{"peer-c", "peer-a", "peer-b"} {
		if err := s.UpsertTOFU(context.Background(), newTestPeerKey(t, name, "")); err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}
	rows, err := s.List(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 3 {
		t.Errorf("len: %d", len(rows))
	}
}
