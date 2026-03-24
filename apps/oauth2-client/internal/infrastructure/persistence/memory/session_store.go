package memory

import (
	"context"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]entity.AuthSession
}

func NewSessionStore() *SessionStore {
	return &SessionStore{sessions: make(map[string]entity.AuthSession)}
}

func (s *SessionStore) Save(_ context.Context, session entity.AuthSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.State] = session
	return nil
}

func (s *SessionStore) FindByState(_ context.Context, state string) (*entity.AuthSession, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[state]
	if !ok {
		return nil, nil
	}
	out := session
	return &out, nil
}

func (s *SessionStore) MarkConsumed(_ context.Context, state string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[state]
	if !ok {
		return nil
	}
	now := time.Now().UTC()
	session.ConsumedAt = &now
	s.sessions[state] = session
	return nil
}
