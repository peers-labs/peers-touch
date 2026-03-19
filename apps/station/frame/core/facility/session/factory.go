package session

import (
	"context"
	"fmt"
	"os"
	"time"
)

// NewFromEnv creates a session store and TTL from environment variables.
func NewFromEnv(ctx context.Context) (Store, time.Duration, error) {
	be := getEnv("PEERS_SESSION_STORE", "memory")
	ttl := parseTTL(24 * time.Hour)
	switch be {
	case "memory":
		return NewMemoryStore(ttl), ttl, nil
	case "disk":
		dir := getEnv("PEERS_SESSION_DIR", "")
		s, err := NewLocalDiskStore(dir, ttl)
		if err != nil {
			return nil, 0, err
		}
		return s, ttl, nil
	case "redis":
		return nil, 0, fmt.Errorf("redis session store not implemented")
	default:
		return NewMemoryStore(ttl), ttl, nil
	}
}

func getEnv(k, def string) string {
	v := os.Getenv(k)
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
