package operatorstore

import (
	"bytes"
	"context"
	"encoding/hex"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
)

type MemoryStore struct {
	mu         sync.Mutex
	attempts   map[string]operator.LoginAttempt
	sessions   map[string]operator.Session
	assertions map[string]struct{}
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		attempts:   make(map[string]operator.LoginAttempt),
		sessions:   make(map[string]operator.Session),
		assertions: make(map[string]struct{}),
	}
}

func (s *MemoryStore) CreateAttempt(
	_ context.Context,
	attempt operator.LoginAttempt,
) error {
	if !validAttempt(attempt) {
		return operator.ErrCorrupt
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.attempts[attempt.AttemptID]; ok {
		if sameAttempt(existing, attempt) {
			return nil
		}
		return operator.ErrAttemptExists
	}
	attempt.ReceiverVerifier = append([]byte(nil), attempt.ReceiverVerifier...)
	s.attempts[attempt.AttemptID] = attempt
	return nil
}

func (s *MemoryStore) FindAttempt(
	_ context.Context,
	attemptID string,
	now time.Time,
) (*operator.LoginAttempt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	attempt, ok := s.attempts[attemptID]
	if !ok {
		return nil, operator.ErrAttemptNotFound
	}
	if attempt.ConsumedAt != nil {
		return nil, operator.ErrAttemptConsumed
	}
	if !now.UTC().Before(attempt.ExpiresAt) {
		return nil, operator.ErrAttemptExpired
	}
	return cloneAttempt(attempt), nil
}

func (s *MemoryStore) CompleteLogin(
	_ context.Context,
	attemptID string,
	assertionDigest []byte,
	session operator.Session,
) error {
	if attemptID == "" ||
		len(assertionDigest) != 32 ||
		!validSession(session) {
		return operator.ErrCorrupt
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	attempt, ok := s.attempts[attemptID]
	if !ok {
		return operator.ErrAttemptNotFound
	}
	if attempt.ConsumedAt != nil {
		return operator.ErrAttemptConsumed
	}
	if !session.IssuedAt.UTC().Before(attempt.ExpiresAt) {
		return operator.ErrAttemptExpired
	}
	assertionKey := hex.EncodeToString(assertionDigest)
	if _, ok := s.assertions[assertionKey]; ok {
		return operator.ErrAssertionReplay
	}
	sessionKey := hex.EncodeToString(session.TokenDigest)
	if existing, ok := s.sessions[sessionKey]; ok &&
		existing.SessionID != session.SessionID {
		return operator.ErrConflict
	}
	consumedAt := session.IssuedAt.UTC()
	attempt.ConsumedAt = &consumedAt
	s.attempts[attemptID] = attempt
	s.assertions[assertionKey] = struct{}{}
	s.sessions[sessionKey] = cloneSessionValue(session)
	return nil
}

func (s *MemoryStore) FindSession(
	_ context.Context,
	tokenDigest []byte,
	now time.Time,
) (*operator.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[hex.EncodeToString(tokenDigest)]
	if !ok {
		return nil, operator.ErrSessionNotFound
	}
	if session.RevokedAt != nil {
		return nil, operator.ErrSessionRevoked
	}
	if !now.UTC().Before(session.ExpiresAt) {
		return nil, operator.ErrSessionExpired
	}
	out := cloneSessionValue(session)
	return &out, nil
}

func (s *MemoryStore) RevokeSession(
	_ context.Context,
	tokenDigest []byte,
	now time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := hex.EncodeToString(tokenDigest)
	session, ok := s.sessions[key]
	if !ok {
		return operator.ErrSessionNotFound
	}
	if session.RevokedAt != nil {
		return nil
	}
	revokedAt := now.UTC()
	session.RevokedAt = &revokedAt
	s.sessions[key] = session
	return nil
}

func validAttempt(attempt operator.LoginAttempt) bool {
	return attempt.SchemaVersion == 1 &&
		attempt.AttemptID != "" &&
		len(attempt.ReceiverVerifier) >= 32 &&
		len(attempt.ReceiverVerifier) <= 128 &&
		!attempt.CreatedAt.IsZero() &&
		attempt.ExpiresAt.After(attempt.CreatedAt)
}

func sameAttempt(left, right operator.LoginAttempt) bool {
	return left.SchemaVersion == right.SchemaVersion &&
		left.AttemptID == right.AttemptID &&
		bytes.Equal(left.ReceiverVerifier, right.ReceiverVerifier) &&
		left.CreatedAt.Equal(right.CreatedAt) &&
		left.ExpiresAt.Equal(right.ExpiresAt)
}

func validSession(session operator.Session) bool {
	return session.SchemaVersion == 1 &&
		session.SessionID != "" &&
		len(session.TokenDigest) == 32 &&
		len(session.CSRFDigest) == 32 &&
		session.Provider != "" &&
		session.ProviderSubject != "" &&
		session.AssertionID != "" &&
		!session.IssuedAt.IsZero() &&
		session.ExpiresAt.After(session.IssuedAt)
}

func cloneAttempt(attempt operator.LoginAttempt) *operator.LoginAttempt {
	out := attempt
	out.ReceiverVerifier = append([]byte(nil), attempt.ReceiverVerifier...)
	return &out
}

func cloneSessionValue(session operator.Session) operator.Session {
	out := session
	out.TokenDigest = append([]byte(nil), session.TokenDigest...)
	out.CSRFDigest = append([]byte(nil), session.CSRFDigest...)
	return out
}
