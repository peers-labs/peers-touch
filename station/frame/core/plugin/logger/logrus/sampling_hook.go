package logrus

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	ls "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

type SamplingConfig struct {
	Enable     bool          `pconf:"enable"`
	Initial    int           `pconf:"initial"`
	Thereafter int           `pconf:"thereafter"`
	Window     time.Duration `pconf:"window"`
	PerPackage bool          `pconf:"per-package"`
}

type PackageSamplingRule struct {
	Package    string
	Initial    int
	Thereafter int
	Window     time.Duration
}

type SamplingHook struct {
	config       SamplingConfig
	packageRules map[string]*PackageSamplingRule
	counters     sync.Map
	mu           sync.RWMutex
}

type samplingCounter struct {
	mu         sync.Mutex
	count      uint64
	lastReset  time.Time
	suppressed uint64
}

func NewSamplingHook(config SamplingConfig, packageRules ...*PackageSamplingRule) *SamplingHook {
	if config.Initial <= 0 {
		config.Initial = 100
	}
	if config.Thereafter <= 0 {
		config.Thereafter = 100
	}
	if config.Window <= 0 {
		config.Window = 1 * time.Minute
	}

	rules := make(map[string]*PackageSamplingRule)
	for _, rule := range packageRules {
		if rule.Initial <= 0 {
			rule.Initial = 100
		}
		if rule.Thereafter <= 0 {
			rule.Thereafter = 100
		}
		if rule.Window <= 0 {
			rule.Window = 1 * time.Minute
		}
		rules[rule.Package] = rule
	}

	return &SamplingHook{
		config:       config,
		packageRules: rules,
	}
}

func (h *SamplingHook) Levels() []ls.Level {
	return []ls.Level{
		ls.DebugLevel,
		ls.InfoLevel,
	}
}

func (h *SamplingHook) Fire(entry *ls.Entry) error {
	if !h.config.Enable {
		return nil
	}

	initial := h.config.Initial
	thereafter := h.config.Thereafter
	window := h.config.Window

	if len(h.packageRules) > 0 && entry.Caller != nil {
		pkgPath := callerPackagePath(entry)
		for pkg, rule := range h.packageRules {
			if matchPackage(pkgPath, pkg) {
				initial = rule.Initial
				thereafter = rule.Thereafter
				window = rule.Window
				break
			}
		}
	}

	key := h.getKey(entry)

	val, _ := h.counters.LoadOrStore(key, &samplingCounter{
		lastReset: time.Now(),
	})
	cnt := val.(*samplingCounter)

	cnt.mu.Lock()
	defer cnt.mu.Unlock()

	if time.Since(cnt.lastReset) > window {
		cnt.count = 0
		cnt.suppressed = 0
		cnt.lastReset = time.Now()
	}

	cnt.count++

	if cnt.count <= uint64(initial) {
		return nil
	}

	if (cnt.count-uint64(initial))%uint64(thereafter) == 0 {
		if cnt.suppressed > 0 {
			if entry.Data == nil {
				entry.Data = make(ls.Fields)
			}
			entry.Data["suppressed_count"] = cnt.suppressed
			cnt.suppressed = 0
		}
		return nil
	}

	cnt.suppressed++
	return fmt.Errorf("log sampled out")
}

func matchPackage(pkgPath, pattern string) bool {
	if pkgPath == pattern {
		return true
	}
	
	if len(pkgPath) > len(pattern) {
		if pkgPath[:len(pattern)] == pattern && (pkgPath[len(pattern)] == '/' || pkgPath[len(pattern)] == '.') {
			return true
		}
		
		suffix := "/" + pattern
		if len(pkgPath) >= len(suffix) && pkgPath[len(pkgPath)-len(suffix):] == suffix {
			return true
		}
	}
	
	return false
}

func (h *SamplingHook) getKey(entry *ls.Entry) string {
	hash := sha256.Sum256([]byte(entry.Message))
	key := hex.EncodeToString(hash[:8])

	if h.config.PerPackage && entry.Caller != nil {
		key = fmt.Sprintf("%s:%s", entry.Caller.Function, key)
	}

	return key
}
