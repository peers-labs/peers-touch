package auth

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type LocalDiskSessionStore struct {
	dir string
	ttl time.Duration
	mu  sync.RWMutex
}

func NewLocalDiskSessionStore(dir string, ttl time.Duration) (*LocalDiskSessionStore, error) {
	if dir == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	s := &LocalDiskSessionStore{dir: dir, ttl: ttl}
	go s.startCleanup()
	return s, nil
}

func (s *LocalDiskSessionStore) path(id string) string {
	return filepath.Join(s.dir, id+".json")
}

func (s *LocalDiskSessionStore) Set(ctx context.Context, sessionID string, session *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if session.ExpiresAt.IsZero() {
		session.ExpiresAt = time.Now().Add(s.ttl)
	}
	b, err := json.Marshal(session)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(sessionID), b, 0o600)
}

func (s *LocalDiskSessionStore) Get(ctx context.Context, sessionID string) (*Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(s.path(sessionID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	var sess Session
	if err := json.Unmarshal(b, &sess); err != nil {
		return nil, err
	}
	if sess.IsExpired() {
		_ = os.Remove(s.path(sessionID))
		return nil, ErrSessionExpired
	}
	sess.Touch()
	_ = s.Set(ctx, sessionID, &sess)
	return &sess, nil
}

func (s *LocalDiskSessionStore) Delete(ctx context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path(sessionID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s *LocalDiskSessionStore) Cleanup(ctx context.Context) error {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	now := time.Now()
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		p := filepath.Join(s.dir, e.Name())
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var sess Session
		if err := json.Unmarshal(b, &sess); err != nil {
			continue
		}
		if sess.ExpiresAt.Before(now) {
			_ = os.Remove(p)
		}
	}
	return nil
}

func (s *LocalDiskSessionStore) startCleanup() {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for range t.C {
		_ = s.Cleanup(context.Background())
	}
}
