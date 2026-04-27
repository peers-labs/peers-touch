package auth

import (
	"os"
	"time"
)

type Config struct {
	Secret         string
	PreviousSecret string
	AccessTTL      time.Duration
}

var cfg Config

// defaultAccessTTL is the JWT lifetime for chat-client tokens. Pinned to 30
// days to match touch.DefaultSessionDuration so a token never outlives — and
// is never cut short by — its backing session record. Anything shorter caused
// "session_revoked" to appear hours after login (see PR-fixing-account-picker
// for the bug history).
const defaultAccessTTL = 30 * 24 * time.Hour

func Init(c Config) {
	cfg = c
	if cfg.AccessTTL == 0 {
		cfg.AccessTTL = defaultAccessTTL
	}
}

func Get() Config {
	if cfg.Secret == "" {
		cfg.Secret = os.Getenv("PEERS_AUTH_SECRET")
	}
	if cfg.PreviousSecret == "" {
		cfg.PreviousSecret = os.Getenv("PEERS_AUTH_PREVIOUS_SECRET")
	}
	if cfg.AccessTTL == 0 {
		cfg.AccessTTL = defaultAccessTTL
	}
	if cfg.Secret == "" {
		panic("core/auth: missing PEERS_AUTH_SECRET")
	}
	return cfg
}
