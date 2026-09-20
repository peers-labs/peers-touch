package federation

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

const testLocalStationPeerID = "station-test"

func TestMintLocalKey_RoundTrip(t *testing.T) {
	now := time.Now()
	k, err := MintLocalKey(now)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if k.IsZero() {
		t.Fatalf("mint produced zero key")
	}
	if k.Kid == "" || len(k.Pub) == 0 || len(k.Priv) == 0 {
		t.Fatalf("mint missing fields: %+v", k)
	}
	parsed, err := ParseLocalKey(k.PrivPEM, k.PubPEM, k.Kid, k.GeneratedAt)
	if err != nil {
		t.Fatalf("parse round-trip: %v", err)
	}
	if parsed.Kid != k.Kid {
		t.Errorf("kid drift after parse: %q vs %q", parsed.Kid, k.Kid)
	}
}

func TestParseLocalKey_RejectsCorruptPEM(t *testing.T) {
	_, err := ParseLocalKey("not a pem", "not a pem", "kid", time.Now())
	if err == nil {
		t.Fatalf("expected parse error")
	}
}

func TestParsePeerJWKPEM_DerivesSameKid(t *testing.T) {
	now := time.Now()
	k, err := MintLocalKey(now)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	_, derived, err := ParsePeerJWKPEM(k.PubPEM)
	if err != nil {
		t.Fatalf("parse jwk: %v", err)
	}
	if derived != k.Kid {
		t.Errorf("jwk-derived kid mismatch: %q vs %q", derived, k.Kid)
	}
}

// ---- InMemoryKeyStore -------------------------------------------------------

func TestInMemoryStore_LoadEmptyReturnsErr(t *testing.T) {
	s := NewInMemoryKeyStore()
	_, err := s.Load(context.Background(), SlotCurrent)
	if !errors.Is(err, ErrNoLocalKey) {
		t.Fatalf("expected ErrNoLocalKey, got %v", err)
	}
}

func TestInMemoryStore_PutAndLoad(t *testing.T) {
	s := NewInMemoryKeyStore()
	k, _ := MintLocalKey(time.Now())
	if err := s.PutCurrent(context.Background(), k); err != nil {
		t.Fatalf("put: %v", err)
	}
	loaded, err := s.Load(context.Background(), SlotCurrent)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Kid != k.Kid {
		t.Errorf("kid drift: %q vs %q", loaded.Kid, k.Kid)
	}
	kid, err := s.LoadCurrentKid(context.Background())
	if err != nil || kid != k.Kid {
		t.Errorf("kid probe: %q err=%v", kid, err)
	}
}

func TestInMemoryStore_PutCurrentRejectsReplacement(t *testing.T) {
	s := NewInMemoryKeyStore()
	first, _ := MintLocalKey(time.Now())
	second, _ := MintLocalKey(time.Now())
	if err := s.PutCurrent(context.Background(), first); err != nil {
		t.Fatalf("put first: %v", err)
	}
	if err := s.PutCurrent(context.Background(), first); err != nil {
		t.Fatalf("idempotent put: %v", err)
	}
	if err := s.PutCurrent(context.Background(), second); !errors.Is(
		err,
		ErrLocalKeyReplacementRequiresRotation,
	) {
		t.Fatalf("replacement error = %v, want rotation-required", err)
	}
}

func TestInMemoryStore_LoadCurrentKid_EmptyReturnsBlank(t *testing.T) {
	s := NewInMemoryKeyStore()
	kid, err := s.LoadCurrentKid(context.Background())
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if kid != "" {
		t.Errorf("expected empty kid, got %q", kid)
	}
}

func TestInMemoryStore_RotateDemotesCurrent(t *testing.T) {
	s := NewInMemoryKeyStore()
	first, _ := MintLocalKey(time.Now())
	if err := s.PutCurrent(context.Background(), first); err != nil {
		t.Fatalf("put first: %v", err)
	}
	second, _ := MintLocalKey(time.Now())
	res, err := s.Rotate(context.Background(), testLocalStationPeerID, second)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if res.NewKid != second.Kid {
		t.Errorf("new kid: %q vs %q", res.NewKid, second.Kid)
	}
	if res.PreviousKid != first.Kid {
		t.Errorf("prev kid: %q vs %q", res.PreviousKid, first.Kid)
	}
	prev, err := s.Load(context.Background(), SlotPrev)
	if err != nil {
		t.Fatalf("load prev: %v", err)
	}
	if prev.Kid != first.Kid {
		t.Errorf("prev slot kid drift: %q vs %q", prev.Kid, first.Kid)
	}
}

func TestInMemoryStore_RotateOnEmptyTreatedAsPut(t *testing.T) {
	s := NewInMemoryKeyStore()
	k, _ := MintLocalKey(time.Now())
	res, err := s.Rotate(context.Background(), testLocalStationPeerID, k)
	if err != nil {
		t.Fatalf("rotate empty: %v", err)
	}
	if res.PreviousKid != "" {
		t.Errorf("expected empty PreviousKid on first rotation, got %q", res.PreviousKid)
	}
	loaded, err := s.Load(context.Background(), SlotCurrent)
	if err != nil || loaded.Kid != k.Kid {
		t.Errorf("post-rotate load: %v / %q", err, loaded.Kid)
	}
}

func TestInMemoryStore_RotateRefusesIdenticalKid(t *testing.T) {
	s := NewInMemoryKeyStore()
	k, _ := MintLocalKey(time.Now())
	if err := s.PutCurrent(context.Background(), k); err != nil {
		t.Fatalf("put: %v", err)
	}
	if _, err := s.Rotate(context.Background(), testLocalStationPeerID, k); err == nil {
		t.Fatalf("expected error on identical-kid rotate")
	}
}

func TestInMemoryStore_ClearPrevIsIdempotent(t *testing.T) {
	s := NewInMemoryKeyStore()
	cleared, err := s.ClearPrev(
		context.Background(),
		"missing-key",
		time.Now(),
	)
	if err != nil || cleared {
		t.Fatalf("clear empty = %v, %v", cleared, err)
	}
	first, _ := MintLocalKey(time.Now())
	_ = s.PutCurrent(context.Background(), first)
	second, _ := MintLocalKey(time.Now())
	_, _ = s.Rotate(context.Background(), testLocalStationPeerID, second)
	prev, err := s.Load(context.Background(), SlotPrev)
	if err != nil {
		t.Fatalf("load previous after rotate: %v", err)
	}
	cleared, err = s.ClearPrev(
		context.Background(),
		prev.Kid,
		prev.UpdatedAt,
	)
	if err != nil || !cleared {
		t.Fatalf("clear after rotate = %v, %v", cleared, err)
	}
	if _, err := s.Load(context.Background(), SlotPrev); !errors.Is(err, ErrNoLocalKey) {
		t.Errorf("prev should be empty after clear, got %v", err)
	}
}

// ---- KeyCache --------------------------------------------------------------

func TestKeyCache_AutoGeneratesOnFirstGet(t *testing.T) {
	store := NewInMemoryKeyStore()
	cache := NewKeyCache(store)
	k, err := cache.Get(context.Background())
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if k == nil || k.IsZero() {
		t.Fatalf("cache returned empty key")
	}
	persisted, _ := store.LoadCurrentKid(context.Background())
	if persisted != k.Kid {
		t.Errorf("persisted kid drift: %q vs %q", persisted, k.Kid)
	}
}

func TestKeyCache_StableAcrossCallsWithoutRecheck(t *testing.T) {
	store := NewInMemoryKeyStore()
	// Disable recheck so the cache strictly memoises.
	cache := NewKeyCache(store, WithRecheckTTL(0))
	first, err := cache.Get(context.Background())
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	for i := 0; i < 5; i++ {
		got, err := cache.Get(context.Background())
		if err != nil {
			t.Fatalf("subsequent[%d]: %v", i, err)
		}
		if got.Kid != first.Kid {
			t.Errorf("kid drift on subsequent get[%d]: %q vs %q", i, got.Kid, first.Kid)
		}
	}
}

func TestKeyCache_DetectsRotationAfterRecheck(t *testing.T) {
	store := NewInMemoryKeyStore()
	// Use a controllable clock so we can force the recheck
	// window without sleeping.
	var nowNS atomic.Int64
	nowNS.Store(time.Now().UnixNano())
	clock := func() time.Time { return time.Unix(0, nowNS.Load()) }
	cache := NewKeyCache(store,
		WithRecheckTTL(10*time.Millisecond),
		WithClock(clock),
	)
	first, err := cache.Get(context.Background())
	if err != nil {
		t.Fatalf("first get: %v", err)
	}

	// Out-of-band rotation (simulates dashboard).
	second, _ := MintLocalKey(clock())
	if _, err := store.Rotate(context.Background(), testLocalStationPeerID, second); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	// Before recheck TTL elapses, the cache should still
	// serve `first`.
	if got, _ := cache.Get(context.Background()); got.Kid != first.Kid {
		t.Errorf("expected cache to still hold first kid pre-recheck, got %q", got.Kid)
	}

	// Advance the clock past the recheck window.
	nowNS.Add(int64(time.Second))

	got, err := cache.Get(context.Background())
	if err != nil {
		t.Fatalf("post-recheck get: %v", err)
	}
	if got.Kid != second.Kid {
		t.Errorf("expected cache to observe rotation, got %q want %q", got.Kid, second.Kid)
	}
}

func TestKeyCache_StickyErrorOnLoadFailure(t *testing.T) {
	bad := &errorKeyStore{loadErr: errors.New("boom")}
	cache := NewKeyCache(bad)
	if _, err := cache.Get(context.Background()); err == nil {
		t.Fatalf("expected sticky load error")
	}
	// Subsequent calls should re-surface the same error
	// without re-running loadOrGenerate.
	if _, err := cache.Get(context.Background()); err == nil {
		t.Fatalf("expected sticky load error second time")
	}
	if bad.loadCalls != 1 {
		t.Errorf("expected exactly one load call, got %d", bad.loadCalls)
	}
}

// errorKeyStore is a minimal stub that fails Load with a given
// error. It is internal to this test file.
type errorKeyStore struct {
	loadErr   error
	loadCalls int
}

func (s *errorKeyStore) Load(ctx context.Context, slot string) (*LocalKey, error) {
	s.loadCalls++
	return nil, s.loadErr
}
func (s *errorKeyStore) LoadCurrentKid(ctx context.Context) (string, error) { return "", nil }
func (s *errorKeyStore) PutCurrent(ctx context.Context, k *LocalKey) error  { return nil }
func (s *errorKeyStore) Rotate(
	ctx context.Context,
	stationPeerID string,
	k *LocalKey,
) (*RotateResult, error) {
	return nil, nil
}
func (s *errorKeyStore) ClearPrev(
	ctx context.Context,
	expectedKeyID string,
	expectedUpdatedAt time.Time,
) (bool, error) {
	return false, nil
}
