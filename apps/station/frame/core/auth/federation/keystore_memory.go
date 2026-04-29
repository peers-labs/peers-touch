package federation

import (
	"context"
	"errors"
	"sync"
	"time"
)

// InMemoryKeyStore is a process-local, RAM-only KeyStore. It
// exists for two purposes:
//
//   - Test fixtures inside this package (and inside any consumer
//     subserver) that want to exercise KeyCache / Mint / Verify
//     without standing up a real database.
//   - Future ephemeral deployments where federation is desired
//     but persistence is not — for example a CLI tool that signs
//     a one-shot peer JWT for an operator-driven cross-station
//     fetch.
//
// Strict: Rotate refuses an identical-kid replacement (same
// rule as the GORM impl) so contract tests hit the same
// edge cases.
type InMemoryKeyStore struct {
	mu      sync.RWMutex
	current *AuthLocalKeyRow
	prev    *AuthLocalKeyRow
	clock   func() time.Time
}

// NewInMemoryKeyStore returns an empty in-memory KeyStore. The
// clock seam is exposed so tests can advance time deterministically
// when validating GeneratedAt / UpdatedAt timestamps.
func NewInMemoryKeyStore(opts ...InMemoryOption) *InMemoryKeyStore {
	s := &InMemoryKeyStore{clock: time.Now}
	for _, o := range opts {
		o(s)
	}
	return s
}

// InMemoryOption follows the functional-options pattern used
// throughout the framework. The only knob today is the clock.
type InMemoryOption func(*InMemoryKeyStore)

// WithMemoryClock overrides the in-memory store's clock.
func WithMemoryClock(fn func() time.Time) InMemoryOption {
	return func(s *InMemoryKeyStore) { s.clock = fn }
}

func (s *InMemoryKeyStore) Load(ctx context.Context, slot string) (*LocalKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	row := s.rowForSlot(slot)
	if row == nil {
		return nil, ErrNoLocalKey
	}
	return ParseLocalKey(row.PrivPEM, row.PubPEM, row.Kid, row.GeneratedAt)
}

func (s *InMemoryKeyStore) LoadCurrentKid(ctx context.Context) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil {
		return "", nil
	}
	return s.current.Kid, nil
}

func (s *InMemoryKeyStore) PutCurrent(ctx context.Context, k *LocalKey) error {
	if k == nil || k.IsZero() {
		return errors.New("federation: memstore: PutCurrent: empty key")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	s.current = rowFromLocalKey(SlotCurrent, k, now)
	return nil
}

func (s *InMemoryKeyStore) Rotate(ctx context.Context, newKey *LocalKey) (*RotateResult, error) {
	if newKey == nil || newKey.IsZero() {
		return nil, errors.New("federation: memstore: Rotate: empty key")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil && s.current.Kid == newKey.Kid {
		return nil, errors.New("federation: memstore: Rotate: new kid identical to current")
	}
	now := s.clock()
	res := &RotateResult{NewKid: newKey.Kid, RotatedAt: now}
	if s.current != nil {
		res.PreviousKid = s.current.Kid
		demoted := *s.current
		demoted.Slot = SlotPrev
		demoted.UpdatedAt = now
		s.prev = &demoted
	}
	s.current = rowFromLocalKey(SlotCurrent, newKey, now)
	return res, nil
}

func (s *InMemoryKeyStore) ClearPrev(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prev = nil
	return nil
}

func (s *InMemoryKeyStore) rowForSlot(slot string) *AuthLocalKeyRow {
	switch slot {
	case SlotCurrent:
		return s.current
	case SlotPrev:
		return s.prev
	default:
		return nil
	}
}

func rowFromLocalKey(slot string, k *LocalKey, now time.Time) *AuthLocalKeyRow {
	return &AuthLocalKeyRow{
		Slot:        slot,
		Kid:         k.Kid,
		PrivPEM:     k.PrivPEM,
		PubPEM:      k.PubPEM,
		GeneratedAt: orNow(k.GeneratedAt, now),
		UpdatedAt:   now,
	}
}
