package logrus

import (
	"runtime"
	"testing"
	"time"

	ls "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

func TestSamplingHook_Fire(t *testing.T) {
	tests := []struct {
		name       string
		config     SamplingConfig
		logCount   int
		wantPassed int
	}{
		{
			name: "disabled sampling passes all logs",
			config: SamplingConfig{
				Enable:     false,
				Initial:    10,
				Thereafter: 10,
			},
			logCount:   100,
			wantPassed: 100,
		},
		{
			name: "initial 10 then 1/10",
			config: SamplingConfig{
				Enable:     true,
				Initial:    10,
				Thereafter: 10,
				Window:     1 * time.Minute,
			},
			logCount:   100,
			wantPassed: 10 + 9,
		},
		{
			name: "initial 5 then 1/5",
			config: SamplingConfig{
				Enable:     true,
				Initial:    5,
				Thereafter: 5,
				Window:     1 * time.Minute,
			},
			logCount:   50,
			wantPassed: 5 + 9,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hook := NewSamplingHook(tt.config)
			passed := 0

			for i := 0; i < tt.logCount; i++ {
				entry := &ls.Entry{
					Message: "test message",
					Data:    make(ls.Fields),
				}

				err := hook.Fire(entry)
				if err == nil {
					passed++
				}
			}

			if passed != tt.wantPassed {
				t.Errorf("passed = %d, want %d", passed, tt.wantPassed)
			}
		})
	}
}

func TestSamplingHook_WindowReset(t *testing.T) {
	config := SamplingConfig{
		Enable:     true,
		Initial:    5,
		Thereafter: 10,
		Window:     100 * time.Millisecond,
	}

	hook := NewSamplingHook(config)
	passed := 0

	for i := 0; i < 10; i++ {
		entry := &ls.Entry{
			Message: "test message",
			Data:    make(ls.Fields),
		}
		if err := hook.Fire(entry); err == nil {
			passed++
		}
	}

	if passed != 5 {
		t.Errorf("first window: passed = %d, want 5", passed)
	}

	time.Sleep(150 * time.Millisecond)

	passed = 0
	for i := 0; i < 10; i++ {
		entry := &ls.Entry{
			Message: "test message",
			Data:    make(ls.Fields),
		}
		if err := hook.Fire(entry); err == nil {
			passed++
		}
	}

	if passed != 5 {
		t.Errorf("after window reset: passed = %d, want 5", passed)
	}
}

func TestSamplingHook_SuppressedCount(t *testing.T) {
	config := SamplingConfig{
		Enable:     true,
		Initial:    2,
		Thereafter: 5,
		Window:     1 * time.Minute,
	}

	hook := NewSamplingHook(config)

	for i := 0; i < 10; i++ {
		entry := &ls.Entry{
			Message: "test message",
			Data:    make(ls.Fields),
		}
		hook.Fire(entry)

		if i == 6 {
			if count, ok := entry.Data["suppressed_count"]; ok {
				if count.(uint64) != 4 {
					t.Errorf("suppressed_count = %v, want 4", count)
				}
			} else {
				t.Error("expected suppressed_count field")
			}
		}
	}
}

func TestSamplingHook_Levels(t *testing.T) {
	hook := NewSamplingHook(SamplingConfig{Enable: true})
	levels := hook.Levels()

	if len(levels) != 2 {
		t.Errorf("levels count = %d, want 2", len(levels))
	}

	hasDebug := false
	hasInfo := false
	for _, level := range levels {
		if level == ls.DebugLevel {
			hasDebug = true
		}
		if level == ls.InfoLevel {
			hasInfo = true
		}
	}

	if !hasDebug || !hasInfo {
		t.Error("expected Debug and Info levels only")
	}
}

func TestSamplingHook_PackageRules(t *testing.T) {
	config := SamplingConfig{
		Enable:     true,
		Initial:    100,
		Thereafter: 100,
		Window:     1 * time.Minute,
	}

	registryRule := &PackageSamplingRule{
		Package:    "plugin/native/registry",
		Initial:    5,
		Thereafter: 10,
		Window:     1 * time.Minute,
	}

	hook := NewSamplingHook(config, registryRule)

	registryPassed := 0
	for i := 0; i < 20; i++ {
		entry := &ls.Entry{
			Message: "health check",
			Data:    make(ls.Fields),
			Caller: &runtime.Frame{
				Function: "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry.HealthCheck",
			},
		}
		if err := hook.Fire(entry); err == nil {
			registryPassed++
		}
	}

	if registryPassed != 6 {
		t.Errorf("registry passed = %d, want 6 (5 initial + 1 thereafter)", registryPassed)
	}

	otherPassed := 0
	for i := 0; i < 20; i++ {
		entry := &ls.Entry{
			Message: "other log",
			Data:    make(ls.Fields),
			Caller: &runtime.Frame{
				Function: "github.com/peers-labs/peers-touch/station/app/service.DoSomething",
			},
		}
		if err := hook.Fire(entry); err == nil {
			otherPassed++
		}
	}

	if otherPassed != 20 {
		t.Errorf("other passed = %d, want 20 (uses global config: initial=100)", otherPassed)
	}
}
