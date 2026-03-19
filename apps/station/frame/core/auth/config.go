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

func Init(c Config) {
	cfg = c
	if cfg.AccessTTL == 0 {
		cfg.AccessTTL = 7 * 24 * time.Hour
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
		cfg.AccessTTL = 7 * 24 * time.Hour
	}
	if cfg.Secret == "" {
		panic("core/auth: missing PEERS_AUTH_SECRET")
	}
	return cfg
}
