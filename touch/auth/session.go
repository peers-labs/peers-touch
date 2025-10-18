package auth

import (
	"context"
	"sync"
	"time"

	"github.com/peers-touch/peers-touch-go/touch/model/db"
)

// SessionStore defines the interface for session storage
type SessionStore interface {
	// Set stores a session
	Set(ctx context.Context, sessionID string, session *Session) error

	// Get retrieves a session
	Get(ctx context.Context, sessionID string) (*Session, error)

	// Delete removes a session
	Delete(ctx context.Context, sessionID string) error

	// Cleanup removes expired sessions
	Cleanup(ctx context.Context) error
}

// Session represents a user session
type Session struct {
	ID        string    `json:"id"`
	UserID    uint64    `json:"user_id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	LastSeen  time.Time `json:"last_seen"`
	IPAddress string    `json:"ip_address,omitempty"`
	UserAgent string    `json:"user_agent,omitempty"`

	// Additional session data
	Data map[string]interface{} `json:"data,omitempty"`
}

// IsExpired checks if the session has expired
func (s *Session) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

// Touch updates the last seen time
func (s *Session) Touch() {
	s.LastSeen = time.Now()
}

// MemorySessionStore implements SessionStore using in-memory storage
type MemorySessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	ttl      time.Duration
}

// NewMemorySessionStore creates a new in-memory session store
func NewMemorySessionStore(ttl time.Duration) *MemorySessionStore {
	if ttl == 0 {
		ttl = 24 * time.Hour // Default 24 hours
	}

	store := &MemorySessionStore{
		sessions: make(map[string]*Session),
		ttl:      ttl,
	}

	// Start cleanup goroutine
	go store.startCleanup()

	return store
}

// Set stores a session
func (m *MemorySessionStore) Set(ctx context.Context, sessionID string, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Set expiry if not set
	if session.ExpiresAt.IsZero() {
		session.ExpiresAt = time.Now().Add(m.ttl)
	}

	m.sessions[sessionID] = session
	return nil
}

// Get retrieves a session
func (m *MemorySessionStore) Get(ctx context.Context, sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, ErrSessionNotFound
	}

	if session.IsExpired() {
		// Remove expired session
		m.mu.RUnlock()
		m.mu.Lock()
		delete(m.sessions, sessionID)
		m.mu.Unlock()
		m.mu.RLock()
		return nil, ErrSessionExpired
	}

	// Touch the session
	session.Touch()

	return session, nil
}

// Delete removes a session
func (m *MemorySessionStore) Delete(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.sessions, sessionID)
	return nil
}

// Cleanup removes expired sessions
func (m *MemorySessionStore) Cleanup(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for id, session := range m.sessions {
		if session.ExpiresAt.Before(now) {
			delete(m.sessions, id)
		}
	}

	return nil
}

// startCleanup starts a goroutine to periodically clean up expired sessions
func (m *MemorySessionStore) startCleanup() {
	ticker := time.NewTicker(time.Hour) // Cleanup every hour
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.Cleanup(context.Background())
		}
	}
}

// SessionManager manages user sessions
type SessionManager struct {
	store SessionStore
	ttl   time.Duration
}

// NewSessionManager creates a new session manager
func NewSessionManager(store SessionStore, ttl time.Duration) *SessionManager {
	if ttl == 0 {
		ttl = 24 * time.Hour // Default 24 hours
	}

	return &SessionManager{
		store: store,
		ttl:   ttl,
	}
}

// CreateSession creates a new session for a user
func (sm *SessionManager) CreateSession(ctx context.Context, user *db.Actor, sessionID, ipAddress, userAgent string) (*Session, error) {
	session := &Session{
		ID:        sessionID,
		UserID:    user.InternalID,
		Email:     user.Email,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(sm.ttl),
		LastSeen:  time.Now(),
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Data:      make(map[string]interface{}),
	}

	err := sm.store.Set(ctx, sessionID, session)
	if err != nil {
		return nil, err
	}

	return session, nil
}

// GetSession retrieves a session by ID
func (sm *SessionManager) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	return sm.store.Get(ctx, sessionID)
}

// DeleteSession removes a session
func (sm *SessionManager) DeleteSession(ctx context.Context, sessionID string) error {
	return sm.store.Delete(ctx, sessionID)
}

// ValidateSession validates a session and returns the associated user
func (sm *SessionManager) ValidateSession(ctx context.Context, sessionID string) (*Session, error) {
	session, err := sm.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	if session.IsExpired() {
		// Clean up expired session
		sm.DeleteSession(ctx, sessionID)
		return nil, ErrSessionExpired
	}

	return session, nil
}
