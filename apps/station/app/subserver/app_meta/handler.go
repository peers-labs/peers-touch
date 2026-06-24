package app_meta

import (
	"context"
	"os"
	"runtime"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var (
	BuildCommit = "unknown"
	BuildLabel  = "dev"
	BuildTime   = "unknown"
)

type versionRequest struct{}

type versionResponse struct {
	Service     string `json:"service"`
	BuildCommit string `json:"build_commit"`
	BuildLabel  string `json:"build_label"`
	BuildTime   string `json:"build_time"`
	GoVersion   string `json:"go_version"`
}

func (s *subServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewTypedHandler("app-meta-version", "/app-meta/version", server.GET, s.handleVersion),
	}
}

func (s *subServer) handleVersion(ctx context.Context, _ *versionRequest) (*versionResponse, error) {
	return &versionResponse{
		Service:     "peers-touch-station",
		BuildCommit: valueFromEnv("PEERS_TOUCH_BUILD_COMMIT", BuildCommit),
		BuildLabel:  valueFromEnv("PEERS_TOUCH_BUILD_LABEL", BuildLabel),
		BuildTime:   valueFromEnv("PEERS_TOUCH_BUILD_TIME", BuildTime),
		GoVersion:   runtime.Version(),
	}, nil
}

func valueFromEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
