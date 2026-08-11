package application

import (
	"net/http"
	"strings"
	"testing"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
)

func TestPublishAttachmentMetricSnapshotUsesBoundedDurableProjection(t *testing.T) {
	provider := &attachmentMetricTestProvider{
		gauges: make(map[string]*attachmentMetricTestGauge),
	}
	previous := metrics.Get()
	metrics.SetProvider(provider)
	t.Cleanup(func() {
		metrics.SetProvider(previous)
	})

	publishAttachmentMetricSnapshot(&messaging.AttachmentMetricsSnapshot{
		Events: []messaging.AttachmentMetric{{
			Action:  messaging.AttachmentAuditPart,
			Outcome: messaging.AttachmentAuditOutcomeCommitted,
			Count:   3,
			Bytes:   4096,
		}},
		ActiveUploads:             2,
		CompleteUnattachedObjects: 1,
		AttachedObjects:           4,
	})

	assertAttachmentGauge(
		t,
		provider,
		"messaging_attachment_audit_events",
		3,
		messaging.AttachmentAuditPart,
		messaging.AttachmentAuditOutcomeCommitted,
	)
	assertAttachmentGauge(
		t,
		provider,
		"messaging_attachment_audit_bytes",
		4096,
		messaging.AttachmentAuditPart,
		messaging.AttachmentAuditOutcomeCommitted,
	)
	assertAttachmentGauge(t, provider, "messaging_attachment_active_uploads", 2)
	assertAttachmentGauge(
		t,
		provider,
		"messaging_attachment_objects",
		1,
		messaging.AttachmentObjectStateCompleteUnattached,
	)
	assertAttachmentGauge(
		t,
		provider,
		"messaging_attachment_objects",
		4,
		messaging.AttachmentObjectStateAttached,
	)
}

func assertAttachmentGauge(
	t *testing.T,
	provider *attachmentMetricTestProvider,
	name string,
	want float64,
	labels ...string,
) {
	t.Helper()
	gauge := provider.gauges[name]
	if gauge == nil {
		t.Fatalf("metric %s was not registered", name)
	}
	if got := gauge.values[strings.Join(labels, "\x00")]; got != want {
		t.Fatalf("metric %s%v = %v, want %v", name, labels, got, want)
	}
}

type attachmentMetricTestProvider struct {
	gauges map[string]*attachmentMetricTestGauge
}

func (*attachmentMetricTestProvider) Counter(string, string, ...string) metrics.Counter {
	return attachmentMetricTestCounter{}
}

func (p *attachmentMetricTestProvider) Gauge(
	name string,
	_ string,
	_ ...string,
) metrics.Gauge {
	gauge := p.gauges[name]
	if gauge == nil {
		gauge = &attachmentMetricTestGauge{values: make(map[string]float64)}
		p.gauges[name] = gauge
	}
	return gauge
}

func (*attachmentMetricTestProvider) Histogram(
	string,
	string,
	[]float64,
	...string,
) metrics.Histogram {
	return attachmentMetricTestHistogram{}
}

func (*attachmentMetricTestProvider) Handler() http.Handler {
	return http.NotFoundHandler()
}

type attachmentMetricTestCounter struct{}

func (attachmentMetricTestCounter) Inc(...string)          {}
func (attachmentMetricTestCounter) Add(float64, ...string) {}

type attachmentMetricTestGauge struct {
	values map[string]float64
}

func (g *attachmentMetricTestGauge) Set(value float64, labels ...string) {
	g.values[strings.Join(labels, "\x00")] = value
}

func (*attachmentMetricTestGauge) Inc(...string)          {}
func (*attachmentMetricTestGauge) Dec(...string)          {}
func (*attachmentMetricTestGauge) Add(float64, ...string) {}

type attachmentMetricTestHistogram struct{}

func (attachmentMetricTestHistogram) Observe(float64, ...string) {}
