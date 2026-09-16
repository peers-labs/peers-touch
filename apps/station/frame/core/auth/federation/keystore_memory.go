package federation

import (
	"bytes"
	"context"
	"errors"
	"strings"
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
	history map[contentProofKeyIdentity][]byte
	clock   func() time.Time
}

type contentProofKeyIdentity struct {
	stationPeerID string
	signingKeyID  string
}

// NewInMemoryKeyStore returns an empty in-memory KeyStore. The
// clock seam is exposed so tests can advance time deterministically
// when validating GeneratedAt / UpdatedAt timestamps.
func NewInMemoryKeyStore(opts ...InMemoryOption) *InMemoryKeyStore {
	s := &InMemoryKeyStore{
		history: make(map[contentProofKeyIdentity][]byte),
		clock:   time.Now,
	}
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
	key, err := ParseLocalKey(row.PrivPEM, row.PubPEM, row.Kid, row.GeneratedAt)
	if err != nil {
		return nil, err
	}
	key.UpdatedAt = row.UpdatedAt
	return key, nil
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
	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil {
		if s.current.Kid == k.Kid &&
			s.current.PrivPEM == k.PrivPEM &&
			s.current.PubPEM == k.PubPEM {
			return nil
		}
		return ErrLocalKeyReplacementRequiresRotation
	}
	now := s.clock()
	s.current = rowFromLocalKey(SlotCurrent, k, now)
	return nil
}

func (s *InMemoryKeyStore) Rotate(
	ctx context.Context,
	stationPeerID string,
	newKey *LocalKey,
) (*RotateResult, error) {
	stationPeerID = strings.TrimSpace(stationPeerID)
	if stationPeerID == "" {
		return nil, errors.New("federation: memstore: Rotate: station peer id is required")
	}
	if newKey == nil || newKey.IsZero() {
		return nil, errors.New("federation: memstore: Rotate: empty key")
	}
	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil && s.current.Kid == newKey.Kid {
		return nil, errors.New("federation: memstore: Rotate: new kid identical to current")
	}
	now := s.clock()
	res := &RotateResult{NewKid: newKey.Kid, RotatedAt: now}
	if s.current != nil {
		publicKey, derivedKeyID, err := ParsePeerJWKPEM(s.current.PubPEM)
		if err != nil {
			return nil, err
		}
		if derivedKeyID != s.current.Kid {
			return nil, errors.New("federation: memstore: Rotate: current kid does not match public key")
		}
		identity := contentProofKeyIdentity{
			stationPeerID: stationPeerID,
			signingKeyID:  s.current.Kid,
		}
		if archived, exists := s.history[identity]; exists &&
			!bytes.Equal(archived, publicKey) {
			return nil, errors.New("federation: memstore: Rotate: immutable history conflict")
		}

		res.PreviousKid = s.current.Kid
		demoted := *s.current
		demoted.Slot = SlotPrev
		demoted.UpdatedAt = now
		s.history[identity] = append([]byte(nil), publicKey...)
		s.prev = &demoted
	}
	s.current = rowFromLocalKey(SlotCurrent, newKey, now)
	return res, nil
}

func (s *InMemoryKeyStore) resolveArchivedContentProofVerificationKey(
	ctx context.Context,
	stationPeerID string,
	signingKeyID string,
) ([]byte, error) {
	stationPeerID = strings.TrimSpace(stationPeerID)
	signingKeyID = strings.TrimSpace(signingKeyID)
	if stationPeerID == "" || signingKeyID == "" {
		return nil, contentProofKeyUnavailable(stationPeerID, signingKeyID)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	publicKey, ok := s.history[contentProofKeyIdentity{
		stationPeerID: stationPeerID,
		signingKeyID:  signingKeyID,
	}]
	if !ok {
		return nil, contentProofKeyUnavailable(stationPeerID, signingKeyID)
	}
	return append([]byte(nil), publicKey...), nil
}

func (s *InMemoryKeyStore) ClearPrev(
	ctx context.Context,
	expectedKeyID string,
	expectedUpdatedAt time.Time,
) (bool, error) {
	if strings.TrimSpace(expectedKeyID) == "" || expectedUpdatedAt.IsZero() {
		return false, errors.New(
			"federation: memstore: ClearPrev: expected identity is required",
		)
	}
	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.prev == nil ||
		s.prev.Kid != expectedKeyID ||
		!s.prev.UpdatedAt.Equal(expectedUpdatedAt) {
		return false, nil
	}
	s.prev = nil
	return true, nil
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
