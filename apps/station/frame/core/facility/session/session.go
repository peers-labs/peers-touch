package session

import (
	"context"
	"sync"
	"time"
)

type Store interface {
	Set(ctx context.Context, sessionID string, session *Session) error
	Get(ctx context.Context, sessionID string) (*Session, error)
	Delete(ctx context.Context, sessionID string) error
	Cleanup(ctx context.Context) error
}

type Session struct {
	ID        string
	UserID    uint64
	Email     string
	CreatedAt time.Time
	ExpiresAt time.Time
	LastSeen  time.Time
	IPAddress string
	UserAgent string
	Data      map[string]interface{}
}

// IsExpired reports whether the session is already expired.
func (s *Session) IsExpired() bool {
	now := time.Now()

	return now.After(s.ExpiresAt)
}

// Touch updates LastSeen to current time.
func (s *Session) Touch() {
	s.LastSeen = time.Now()
}

type MemoryStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	ttl      time.Duration
}

// NewMemoryStore creates an in-memory session store with the given TTL.
func NewMemoryStore(ttl time.Duration) *MemoryStore {
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	m := &MemoryStore{sessions: map[string]*Session{}, ttl: ttl}
	go m.startCleanup()
	return m
}

// Set stores or updates the session under the given ID.
func (m *MemoryStore) Set(ctx context.Context, sessionID string, s *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.ExpiresAt.IsZero() {
		s.ExpiresAt = time.Now().Add(m.ttl)
	}
	m.sessions[sessionID] = s
	return nil
}

// Get retrieves a session by ID, touching LastSeen and expiring if needed.
func (m *MemoryStore) Get(ctx context.Context, sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if s.IsExpired() {
		m.mu.RUnlock()
		m.mu.Lock()
		delete(m.sessions, sessionID)
		m.mu.Unlock()
		m.mu.RLock()
		return nil, ErrSessionExpired
	}
	s.Touch()
	return s, nil
}

// Delete removes a session by ID.
func (m *MemoryStore) Delete(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
	return nil
}

// Cleanup removes expired sessions.
func (m *MemoryStore) Cleanup(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for id, s := range m.sessions {
		if s.ExpiresAt.Before(now) {
			delete(m.sessions, id)
		}
	}
	return nil
}

func (m *MemoryStore) startCleanup() {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for range t.C {
		_ = m.Cleanup(context.Background())
	}
}

type KickableStore interface {
	Store
	CreateWithKick(ctx context.Context, sess *Session, deviceType DeviceType) (*Session, int64, error)
	CheckSessionValid(ctx context.Context, sessionID string) (bool, string)
}

type Manager struct {
	store Store
	ttl   time.Duration
}

func NewManager(store Store, ttl time.Duration) *Manager {
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	return &Manager{store: store, ttl: ttl}
}

func (m *Manager) Create(ctx context.Context, userID uint64, email, sessionID, ip, ua string) (*Session, error) {
	s := &Session{
		ID:        sessionID,
		UserID:    userID,
		Email:     email,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(m.ttl),
		LastSeen:  time.Now(),
		IPAddress: ip,
		UserAgent: ua,
		Data:      map[string]interface{}{},
	}
	if err := m.store.Set(ctx, sessionID, s); err != nil {
		return nil, err
	}
	return s, nil
}

func (m *Manager) CreateWithKick(ctx context.Context, sess *Session, deviceType DeviceType) (*Session, int64, error) {
	if ks, ok := m.store.(KickableStore); ok {
		return ks.CreateWithKick(ctx, sess, deviceType)
	}
	if err := m.store.Set(ctx, sess.ID, sess); err != nil {
		return nil, 0, err
	}
	return sess, 0, nil
}

func (m *Manager) Get(ctx context.Context, sessionID string) (*Session, error) {
	return m.store.Get(ctx, sessionID)
}

func (m *Manager) Delete(ctx context.Context, sessionID string) error {
	return m.store.Delete(ctx, sessionID)
}

func (m *Manager) Validate(ctx context.Context, sessionID string) (*Session, error) {
	s, err := m.Get(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if s.IsExpired() {
		_ = m.Delete(ctx, sessionID)
		return nil, ErrSessionExpired
	}
	return s, nil
}

func (m *Manager) CheckValid(ctx context.Context, sessionID string) (bool, string) {
	if ks, ok := m.store.(KickableStore); ok {
		return ks.CheckSessionValid(ctx, sessionID)
	}
	_, err := m.Validate(ctx, sessionID)
	if err != nil {
		if err == ErrSessionExpired {
			return false, "expired"
		}
		return false, "not_found"
	}
	return true, ""
}

// CheckSessionValid satisfies coreauth.SessionValidator, delegates to CheckValid.
func (m *Manager) CheckSessionValid(ctx context.Context, sessionID string) (bool, string) {
	return m.CheckValid(ctx, sessionID)
}

// ResolveSessionDeviceType satisfies coreauth.SessionDeviceTypeResolver.
// It returns the device_type stored on the session record, or empty string
// if the underlying store does not support the lookup.
func (m *Manager) ResolveSessionDeviceType(ctx context.Context, sessionID string) string {
	type deviceTypeResolver interface {
		ResolveSessionDeviceType(ctx context.Context, sessionID string) string
	}
	if resolver, ok := m.store.(deviceTypeResolver); ok {
		return resolver.ResolveSessionDeviceType(ctx, sessionID)
	}
	return ""
}
