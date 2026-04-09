package prometheus

// 2026-04-07: Rewrote remote_write using official buf.build/prometheus prompb
// protobuf types instead of hand-rolled wire-format encoder. Depends only on
// the lightweight buf.build generated package + snappy, NOT the full
// prometheus/prometheus dependency tree.

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/golang/snappy"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	dto "github.com/prometheus/client_model/go"
	"google.golang.org/protobuf/proto"

	prompb "buf.build/gen/go/prometheus/prometheus/protocolbuffers/go"
)

// RemoteWriteConfig holds the Grafana Cloud (or any Prometheus-compatible
// remote_write endpoint) configuration.
type RemoteWriteConfig struct {
	Enabled  bool
	Endpoint string        // e.g. https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/push
	Username string        // Grafana Cloud numeric user ID
	Password string        // Grafana Cloud API key
	Interval time.Duration // push interval, default 15s
}

// StartRemoteWrite launches a background goroutine that periodically gathers
// metrics from the Provider's registry and pushes them via Prometheus
// remote_write v1 protocol to the configured endpoint.
func (p *Provider) StartRemoteWrite(ctx context.Context, cfg RemoteWriteConfig) {
	if !cfg.Enabled || cfg.Endpoint == "" {
		return
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 15 * time.Second
	}

	go p.remoteWriteLoop(ctx, cfg)
}

func (p *Provider) remoteWriteLoop(ctx context.Context, cfg RemoteWriteConfig) {
	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	client := &http.Client{Timeout: 10 * time.Second}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := p.pushOnce(ctx, client, cfg); err != nil {
				logger.Warnf(ctx, "[metrics] remote_write push failed: %v", err)
			}
		}
	}
}

func (p *Provider) pushOnce(ctx context.Context, client *http.Client, cfg RemoteWriteConfig) error {
	mfs, err := p.registry.Gather()
	if err != nil {
		return fmt.Errorf("gather: %w", err)
	}
	if len(mfs) == 0 {
		return nil
	}

	writeReq := gatherToWriteRequest(mfs)
	if len(writeReq.GetTimeseries()) == 0 {
		return nil
	}

	data, err := proto.Marshal(writeReq)
	if err != nil {
		return fmt.Errorf("proto marshal: %w", err)
	}

	compressed := snappy.Encode(nil, data)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.Endpoint, bytes.NewReader(compressed))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("Content-Encoding", "snappy")
	req.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
	if cfg.Username != "" && cfg.Password != "" {
		req.SetBasicAuth(cfg.Username, cfg.Password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return nil
}

// gatherToWriteRequest converts client_model MetricFamily slices (from
// registry.Gather()) into a prompb.WriteRequest suitable for remote_write v1.
func gatherToWriteRequest(mfs []*dto.MetricFamily) *prompb.WriteRequest {
	nowMs := time.Now().UnixMilli()
	var timeseries []*prompb.TimeSeries

	for _, mf := range mfs {
		name := mf.GetName()

		for _, m := range mf.GetMetric() {
			baseLabels := buildPrompbLabels(name, m.GetLabel())

			switch mf.GetType() {
			case dto.MetricType_COUNTER:
				if c := m.GetCounter(); c != nil {
					timeseries = append(timeseries, newTimeSeries(baseLabels, c.GetValue(), nowMs))
				}

			case dto.MetricType_GAUGE:
				if g := m.GetGauge(); g != nil {
					timeseries = append(timeseries, newTimeSeries(baseLabels, g.GetValue(), nowMs))
				}

			case dto.MetricType_HISTOGRAM:
				if h := m.GetHistogram(); h != nil {
					for _, b := range h.GetBucket() {
						bucketLabels := appendLabel(baseLabels, "le", formatFloat(b.GetUpperBound()))
						timeseries = append(timeseries, newTimeSeries(bucketLabels, float64(b.GetCumulativeCount()), nowMs))
					}

					infLabels := appendLabel(baseLabels, "le", "+Inf")
					timeseries = append(timeseries, newTimeSeries(infLabels, float64(h.GetSampleCount()), nowMs))

					timeseries = append(timeseries, newTimeSeries(relabelName(baseLabels, name+"_sum"), h.GetSampleSum(), nowMs))
					timeseries = append(timeseries, newTimeSeries(relabelName(baseLabels, name+"_count"), float64(h.GetSampleCount()), nowMs))
					continue
				}

			case dto.MetricType_SUMMARY:
				if s := m.GetSummary(); s != nil {
					for _, q := range s.GetQuantile() {
						qLabels := appendLabel(baseLabels, "quantile", formatFloat(q.GetQuantile()))
						timeseries = append(timeseries, newTimeSeries(qLabels, q.GetValue(), nowMs))
					}
					timeseries = append(timeseries, newTimeSeries(relabelName(baseLabels, name+"_sum"), s.GetSampleSum(), nowMs))
					timeseries = append(timeseries, newTimeSeries(relabelName(baseLabels, name+"_count"), float64(s.GetSampleCount()), nowMs))
					continue
				}

			case dto.MetricType_UNTYPED:
				if u := m.GetUntyped(); u != nil {
					timeseries = append(timeseries, newTimeSeries(baseLabels, u.GetValue(), nowMs))
				}
			}
		}
	}

	return &prompb.WriteRequest{Timeseries: timeseries}
}

// ---- helpers ----

func newTimeSeries(labels []*prompb.Label, value float64, timestampMs int64) *prompb.TimeSeries {
	return &prompb.TimeSeries{
		Labels:  labels,
		Samples: []*prompb.Sample{{Value: value, Timestamp: timestampMs}},
	}
}

func buildPrompbLabels(metricName string, lps []*dto.LabelPair) []*prompb.Label {
	out := make([]*prompb.Label, 0, len(lps)+1)
	out = append(out, &prompb.Label{Name: "__name__", Value: metricName})
	for _, lp := range lps {
		out = append(out, &prompb.Label{Name: lp.GetName(), Value: lp.GetValue()})
	}
	return out
}

func appendLabel(base []*prompb.Label, name, value string) []*prompb.Label {
	cp := make([]*prompb.Label, len(base), len(base)+1)
	copy(cp, base)
	return append(cp, &prompb.Label{Name: name, Value: value})
}

func relabelName(labels []*prompb.Label, newName string) []*prompb.Label {
	cp := make([]*prompb.Label, len(labels))
	for i, l := range labels {
		if l.GetName() == "__name__" {
			cp[i] = &prompb.Label{Name: "__name__", Value: newName}
		} else {
			cp[i] = l
		}
	}
	return cp
}

func formatFloat(v float64) string {
	if math.IsInf(v, 1) {
		return "+Inf"
	}
	return fmt.Sprintf("%g", v)
}
