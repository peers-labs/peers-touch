package auth

import (
    "context"
    "os"
    "time"
)

type Config struct {
    Secret              string
    AccessTokenDuration time.Duration
    RefreshTokenDuration time.Duration
    SessionDuration     time.Duration
}

var defaultCfg = Config{}

func Init(cfg Config) {
    defaultCfg = cfg
    if defaultCfg.AccessTokenDuration == 0 {
        defaultCfg.AccessTokenDuration = DefaultAccessTokenDuration
    }
    if defaultCfg.RefreshTokenDuration == 0 {
        defaultCfg.RefreshTokenDuration = DefaultRefreshTokenDuration
    }
    if defaultCfg.SessionDuration == 0 {
        defaultCfg.SessionDuration = DefaultSessionDuration
    }
}

func Get() Config {
    if defaultCfg.Secret == "" {
        defaultCfg.Secret = os.Getenv("PEERS_AUTH_SECRET")
    }
    if defaultCfg.AccessTokenDuration == 0 {
        defaultCfg.AccessTokenDuration = DefaultAccessTokenDuration
    }
    if defaultCfg.RefreshTokenDuration == 0 {
        defaultCfg.RefreshTokenDuration = DefaultRefreshTokenDuration
    }
    if defaultCfg.SessionDuration == 0 {
        defaultCfg.SessionDuration = DefaultSessionDuration
    }
    return defaultCfg
}

func DefaultMiddleware(c context.Context) (*AuthMiddleware, error) {
    cfg := Get()
    return CreateAuthMiddleware(c, cfg.Secret)
}
