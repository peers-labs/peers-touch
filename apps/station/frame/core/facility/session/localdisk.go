package session

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type LocalDiskStore struct {
	dir string
	ttl time.Duration
	mu  sync.RWMutex
}

// NewLocalDiskStore creates a disk-backed session store at dir with TTL.
func NewLocalDiskStore(dir string, ttl time.Duration) (*LocalDiskStore, error) {
	if dir == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	s := &LocalDiskStore{dir: dir, ttl: ttl}
	go s.startCleanup()
	return s, nil
}

func (s *LocalDiskStore) path(id string) string {
	p := filepath.Join(s.dir, id+".json")

	return p
}

// Set writes the session to local disk under the given ID.
func (s *LocalDiskStore) Set(ctx context.Context, sessionID string, sess *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess.ExpiresAt.IsZero() {
		sess.ExpiresAt = time.Now().Add(s.ttl)
	}
	b, err := json.Marshal(sess)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(sessionID), b, 0o600)
}

// Get reads a session from local disk, touching LastSeen and expiring if needed.
func (s *LocalDiskStore) Get(ctx context.Context, sessionID string) (*Session, error) {
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

// Delete removes the session file from local disk.
func (s *LocalDiskStore) Delete(ctx context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path(sessionID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Cleanup scans the directory and removes expired session files.
func (s *LocalDiskStore) Cleanup(ctx context.Context) error {
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

func (s *LocalDiskStore) startCleanup() {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for range t.C {
		_ = s.Cleanup(context.Background())
	}
}
