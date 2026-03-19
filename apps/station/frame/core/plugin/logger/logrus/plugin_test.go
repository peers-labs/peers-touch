package logrus

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func TestLogrusLogPlugin_Name(t *testing.T) {
	plugin := &logrusLogPlugin{}
	if plugin.Name() != "slogrus" {
		t.Errorf("expected name 'slogrus', got '%s'", plugin.Name())
	}
}

func TestLogrusLogPlugin_Options_Level(t *testing.T) {
	options.Peers.Logger.Level = "debug"
	options.Peers.Logger.CallerSkipCount = 2

	plugin := &logrusLogPlugin{}
	opts := plugin.Options()

	if len(opts) == 0 {
		t.Error("expected options, got none")
	}

	testOpts := &logger.Options{}
	for _, opt := range opts {
		opt(testOpts)
	}

	if testOpts.Level != logger.DebugLevel {
		t.Errorf("expected DebugLevel, got %v", testOpts.Level)
	}

	if testOpts.CallerSkipCount != 2 {
		t.Errorf("expected CallerSkipCount=2, got %d", testOpts.CallerSkipCount)
	}
}

func TestLogrusLogPlugin_Options_Formatter(t *testing.T) {
	options.Peers.Logger.Logrus.Formatter = "json"

	plugin := &logrusLogPlugin{}
	opts := plugin.Options()

	if len(opts) == 0 {
		t.Error("expected options, got none")
	}
}

func TestLogrusLogPlugin_New(t *testing.T) {
	plugin := &logrusLogPlugin{}
	l := plugin.New()

	if l == nil {
		t.Error("expected logger instance, got nil")
	}

	if l.String() != "slogrus" {
		t.Errorf("expected logger name 'slogrus', got '%s'", l.String())
	}
}

func TestLogrusLogPlugin_Options_PackageFiltering(t *testing.T) {
	options.Peers.Logger.Logrus.IncludePackages = []string{"github.com/peers-labs"}
	options.Peers.Logger.Logrus.ExcludePackages = []string{"gorm.io"}

	plugin := &logrusLogPlugin{}
	opts := plugin.Options()

	if len(opts) == 0 {
		t.Error("expected options, got none")
	}
}
