package metrics

import (
	"net/http"
	"sync"
)

// Provider is the central metrics facade. Implementations (e.g. Prometheus)
// register themselves via SetProvider at init time.
type Provider interface {
	// Counter returns (or creates) a counter identified by name + labels.
	Counter(name, help string, labels ...string) Counter
	// Gauge returns (or creates) a gauge identified by name + labels.
	Gauge(name, help string, labels ...string) Gauge
	// Histogram returns (or creates) a histogram identified by name + labels.
	Histogram(name, help string, buckets []float64, labels ...string) Histogram
	// Handler returns the HTTP handler that exposes metrics (e.g. /metrics).
	Handler() http.Handler
}

type Counter interface {
	Inc(labels ...string)
	Add(v float64, labels ...string)
}

type Gauge interface {
	Set(v float64, labels ...string)
	Inc(labels ...string)
	Dec(labels ...string)
	Add(v float64, labels ...string)
}

type Histogram interface {
	Observe(v float64, labels ...string)
}

// ---- Global singleton ----

var (
	mu       sync.RWMutex
	provider Provider = &noopProvider{}
)

// SetProvider installs the global metrics provider. Must be called before
// any metrics are created (typically from an init() function).
func SetProvider(p Provider) {
	mu.Lock()
	defer mu.Unlock()
	provider = p
}

// Get returns the global metrics provider.
func Get() Provider {
	mu.RLock()
	defer mu.RUnlock()
	return provider
}

// ---- Noop implementation (default when no provider is installed) ----

type noopProvider struct{}

func (noopProvider) Counter(string, string, ...string) Counter                { return noopCounter{} }
func (noopProvider) Gauge(string, string, ...string) Gauge                    { return noopGauge{} }
func (noopProvider) Histogram(string, string, []float64, ...string) Histogram { return noopHistogram{} }
func (noopProvider) Handler() http.Handler                                    { return http.NotFoundHandler() }

type noopCounter struct{}

func (noopCounter) Inc(...string)          {}
func (noopCounter) Add(float64, ...string) {}

type noopGauge struct{}

func (noopGauge) Set(float64, ...string) {}
func (noopGauge) Inc(...string)          {}
func (noopGauge) Dec(...string)          {}
func (noopGauge) Add(float64, ...string) {}

type noopHistogram struct{}

func (noopHistogram) Observe(float64, ...string) {}
