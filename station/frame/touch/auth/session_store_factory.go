package auth

import (
	"context"
	"fmt"
	"os"
	"time"
)

type SessionBackend string

const (
	SessionBackendMemory SessionBackend = "memory"
	SessionBackendDisk   SessionBackend = "disk"
	SessionBackendRedis  SessionBackend = "redis"
)

type SessionStoreConfig struct {
	Backend SessionBackend
	TTL     time.Duration
	Dir     string
}

func getEnv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func parseTTL(def time.Duration) time.Duration {
	v := os.Getenv("PEERS_SESSION_TTL")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

func NewSessionStoreFromEnv(ctx context.Context) (SessionStore, time.Duration, error) {
	backend := SessionBackend(getEnv("PEERS_SESSION_STORE", string(SessionBackendMemory)))
	ttl := parseTTL(24 * time.Hour)
	switch backend {
	case SessionBackendMemory:
		return NewMemorySessionStore(ttl), ttl, nil
	case SessionBackendDisk:
		dir := getEnv("PEERS_SESSION_DIR", "")
		s, err := NewLocalDiskSessionStore(dir, ttl)
		if err != nil {
			return nil, 0, err
		}
		return s, ttl, nil
	case SessionBackendRedis:
		return nil, 0, fmt.Errorf("redis session store not implemented")
	default:
		return NewMemorySessionStore(ttl), ttl, nil
	}
}
