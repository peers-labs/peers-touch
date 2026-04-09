package prometheus

import (
	"net/http"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var _ metrics.Provider = (*Provider)(nil)

// Provider implements metrics.Provider backed by Prometheus client_golang.
type Provider struct {
	registry *prometheus.Registry
	mu       sync.Mutex
	counters map[string]*prometheus.CounterVec
	gauges   map[string]*prometheus.GaugeVec
	histos   map[string]*prometheus.HistogramVec
}

func New() *Provider {
	return &Provider{
		registry: prometheus.NewRegistry(),
		counters: make(map[string]*prometheus.CounterVec),
		gauges:   make(map[string]*prometheus.GaugeVec),
		histos:   make(map[string]*prometheus.HistogramVec),
	}
}

func (p *Provider) Counter(name, help string, labels ...string) metrics.Counter {
	p.mu.Lock()
	defer p.mu.Unlock()

	if cv, ok := p.counters[name]; ok {
		return &counterAdapter{cv: cv}
	}

	cv := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: name,
		Help: help,
	}, labels)
	p.registry.MustRegister(cv)
	p.counters[name] = cv
	return &counterAdapter{cv: cv}
}

func (p *Provider) Gauge(name, help string, labels ...string) metrics.Gauge {
	p.mu.Lock()
	defer p.mu.Unlock()

	if gv, ok := p.gauges[name]; ok {
		return &gaugeAdapter{gv: gv}
	}

	gv := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: name,
		Help: help,
	}, labels)
	p.registry.MustRegister(gv)
	p.gauges[name] = gv
	return &gaugeAdapter{gv: gv}
}

func (p *Provider) Histogram(name, help string, buckets []float64, labels ...string) metrics.Histogram {
	p.mu.Lock()
	defer p.mu.Unlock()

	if hv, ok := p.histos[name]; ok {
		return &histogramAdapter{hv: hv}
	}

	if len(buckets) == 0 {
		buckets = prometheus.DefBuckets
	}

	hv := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    name,
		Help:    help,
		Buckets: buckets,
	}, labels)
	p.registry.MustRegister(hv)
	p.histos[name] = hv
	return &histogramAdapter{hv: hv}
}

func (p *Provider) Handler() http.Handler {
	return promhttp.HandlerFor(p.registry, promhttp.HandlerOpts{})
}

// ---- Adapters ----

type counterAdapter struct {
	cv *prometheus.CounterVec
}

func (c *counterAdapter) Inc(labels ...string) {
	c.cv.WithLabelValues(labels...).Inc()
}

func (c *counterAdapter) Add(v float64, labels ...string) {
	c.cv.WithLabelValues(labels...).Add(v)
}

type gaugeAdapter struct {
	gv *prometheus.GaugeVec
}

func (g *gaugeAdapter) Set(v float64, labels ...string) {
	g.gv.WithLabelValues(labels...).Set(v)
}

func (g *gaugeAdapter) Inc(labels ...string) {
	g.gv.WithLabelValues(labels...).Inc()
}

func (g *gaugeAdapter) Dec(labels ...string) {
	g.gv.WithLabelValues(labels...).Dec()
}

func (g *gaugeAdapter) Add(v float64, labels ...string) {
	g.gv.WithLabelValues(labels...).Add(v)
}

type histogramAdapter struct {
	hv *prometheus.HistogramVec
}

func (h *histogramAdapter) Observe(v float64, labels ...string) {
	h.hv.WithLabelValues(labels...).Observe(v)
}
