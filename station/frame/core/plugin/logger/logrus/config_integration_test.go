package logrus

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	scfg "github.com/peers-labs/peers-touch/station/frame/core/peers/config"
	"github.com/peers-labs/peers-touch/station/frame/core/pkg/config/source/file"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	ls "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

// Test that peers/app/conf/log.yml is read, loaded and applied into slogrus options.
func TestLoggerConfigLoadAndApply(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// go test runs in package dir; navigate to repo root by moving up known segments
	// The conf file path relative to repository root:
	// peers-touch/station/app/conf/peers.yml
	// Attempt to locate repository root from current package path.
	// Walk up until we find station directory.
	base := wd
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(base, "station")); err == nil {
			break
		}
		base = filepath.Dir(base)
	}
	peersYml := filepath.Join(base, "station", "app", "conf", "peers.yml")
	if _, err := os.Stat(peersYml); err != nil {
		t.Fatalf("peers.yml not found: %v", err)
	}

	// Build config with file source pointing to peers.yml (which includes log.yml)
	src := file.NewSource(file.WithPath(peersYml))
	c := cfg.NewConfig(cfg.WithSources(src))
	if err := c.Init(); err != nil {
		t.Fatalf("config init: %v", err)
	}

	// Ensure slogrus plugin is registered via init()
	p, ok := plugin.LoggerPlugins["slogrus"]
	if !ok || p == nil {
		t.Fatalf("slogrus plugin not registered")
	}

	// Collect logger options from peers config and plugin options
	var opts []logger.Option
	// peers logger options (level, persistence, name)
	var pc scfg.PeersConfig
	if err := c.Get("peers").Scan(&pc.Peers); err != nil {
		t.Fatalf("scan peers config: %v", err)
	}
	for _, o := range pc.Peers.Logger.Options() {
		opts = append(opts, o)
	}
	// plugin-specific options (formatter, caller, pkg filter, split-level, etc.)
	for _, o := range p.Options() {
		opts = append(opts, o)
	}

	// Init slogrus logger with composed options
	l := p.New()
	if err := l.Init(context.Background(), opts...); err != nil {
		t.Fatalf("logger init: %v", err)
	}

	// Introspect internal slogrus options
	ll, ok := l.(*logrusLogger)
	if !ok {
		t.Fatalf("type assertion to *logrusLogger failed")
	}

	// Verify general options
	if ll.opts.Level != logger.InfoLevel {
		t.Fatalf("unexpected level: %v", ll.opts.Level)
	}
	if ll.opts.Persistence == nil || !ll.opts.Persistence.Enable {
		t.Fatalf("persistence not enabled or nil")
	}
	if ll.opts.Persistence.Dir == "" {
		t.Fatalf("persistence dir empty")
	}
	if ll.opts.Formatter == nil {
		t.Fatalf("formatter not set")
	}

	// Verify slogrus-specific options from log.yml defaults we set
	if ll.opts.ReportCaller {
		t.Fatalf("expected report-caller=false, got true")
	}
	if ll.opts.SplitLevel {
		t.Fatalf("expected split-level=false, got true")
	}
	// timestamp format should be set for text formatter
	if tf, ok := ll.opts.Formatter.(*ls.TextFormatter); ok {
		if tf.TimestampFormat == "" {
			t.Fatalf("timestamp-format not applied to TextFormatter")
		}
	}

	// Check patterns are read (even if not used by logger implementation)
	if ll.opts.Persistence.FileNamePattern == "" {
		t.Fatalf("file-name-pattern not read")
	}
	if ll.opts.Persistence.BackupFileNamePattern == "" {
		t.Fatalf("backup-file-name-pattern not read")
	}
}
