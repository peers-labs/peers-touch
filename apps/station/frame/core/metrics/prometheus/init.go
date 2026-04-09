package prometheus

// 2026-04-07: Added pconf registration for remote_write config.
// Config is auto-injected from metrics.yml via config.RegisterOptions.
// Call TryStartRemoteWrite() from an AfterStart hook to launch the push goroutine.

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
)

var metricsConfig struct {
	Peers struct {
		Metrics struct {
			Prometheus struct {
				RemoteWrite struct {
					Enabled  bool   `pconf:"enabled"`
					Endpoint string `pconf:"endpoint"`
					Username string `pconf:"username"`
					Password string `pconf:"password"`
					Interval string `pconf:"interval"`
				} `pconf:"remote-write"`
			} `pconf:"prometheus"`
		} `pconf:"metrics"`
	} `pconf:"peers"`
}

func init() {
	config.RegisterOptions(&metricsConfig)
	metrics.SetProvider(New())
}

// TryStartRemoteWrite reads the pconf-injected config and starts
// the remote_write push goroutine if enabled. Should be called from
// an AfterStart lifecycle hook.
func TryStartRemoteWrite(ctx context.Context) {
	cfg := metricsConfig.Peers.Metrics.Prometheus.RemoteWrite
	if !cfg.Enabled || cfg.Endpoint == "" {
		return
	}

	provider, ok := metrics.Get().(*Provider)
	if !ok {
		logger.Warnf(ctx, "[metrics] provider is not Prometheus, skipping remote_write")
		return
	}

	interval := 15 * time.Second
	if cfg.Interval != "" {
		if d, err := time.ParseDuration(cfg.Interval); err == nil {
			interval = d
		}
	}

	provider.StartRemoteWrite(ctx, RemoteWriteConfig{
		Enabled:  true,
		Endpoint: cfg.Endpoint,
		Username: cfg.Username,
		Password: cfg.Password,
		Interval: interval,
	})

	logger.Infof(ctx, "[metrics] remote_write started → %s (interval=%v)", cfg.Endpoint, interval)
}
