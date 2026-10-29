package application

import (
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
)

const (
	federatedPrivateObjectStreamTotalMetric   = "social_cross_station_object_stream_total"
	federatedPrivateObjectStreamLatencyMetric = "social_cross_station_object_stream_latency_seconds"
)

type federatedPrivateObjectStreamStage string
type federatedPrivateObjectStreamOutcome string
type federatedPrivateObjectStreamReason string

const (
	federatedPrivateObjectStageRecipientProxy federatedPrivateObjectStreamStage = "recipient_proxy"
	federatedPrivateObjectStageSourceRead     federatedPrivateObjectStreamStage = "source_read"

	federatedPrivateObjectOutcomeAccepted    federatedPrivateObjectStreamOutcome = "accepted"
	federatedPrivateObjectOutcomeRejected    federatedPrivateObjectStreamOutcome = "rejected"
	federatedPrivateObjectOutcomeInterrupted federatedPrivateObjectStreamOutcome = "interrupted"
	federatedPrivateObjectOutcomeRetryable   federatedPrivateObjectStreamOutcome = "retryable"

	federatedPrivateObjectReasonNone         federatedPrivateObjectStreamReason = "none"
	federatedPrivateObjectReasonNotFound     federatedPrivateObjectStreamReason = "not_found"
	federatedPrivateObjectReasonRangeInvalid federatedPrivateObjectStreamReason = "range_invalid"
	federatedPrivateObjectReasonIntegrity    federatedPrivateObjectStreamReason = "integrity"
	federatedPrivateObjectReasonDependency   federatedPrivateObjectStreamReason = "dependency"
	federatedPrivateObjectReasonCancelled    federatedPrivateObjectStreamReason = "cancelled"
)

type federatedPrivateObjectStreamMetrics struct {
	total   metrics.Counter
	latency metrics.Histogram
}

func newFederatedPrivateObjectStreamMetrics() federatedPrivateObjectStreamMetrics {
	provider := metrics.Get()

	return federatedPrivateObjectStreamMetrics{
		total: provider.Counter(
			federatedPrivateObjectStreamTotalMetric,
			"Cross-Station Social private-object stream attempts",
			"stage",
			"outcome",
			"reason",
		),
		latency: provider.Histogram(
			federatedPrivateObjectStreamLatencyMetric,
			"Cross-Station Social private-object stream latency",
			[]float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
			"stage",
			"outcome",
		),
	}
}

func (m federatedPrivateObjectStreamMetrics) observe(
	startedAt time.Time,
	stage federatedPrivateObjectStreamStage,
	outcome federatedPrivateObjectStreamOutcome,
	reason federatedPrivateObjectStreamReason,
) {
	if !validFederatedPrivateObjectStreamObservation(stage, outcome, reason) {
		panic(fmt.Sprintf(
			"invalid Social private-object stream metric tuple %q/%q/%q",
			stage,
			outcome,
			reason,
		))
	}
	m.total.Inc(string(stage), string(outcome), string(reason))
	m.latency.Observe(
		time.Since(startedAt).Seconds(),
		string(stage),
		string(outcome),
	)
}

func validFederatedPrivateObjectStreamObservation(
	stage federatedPrivateObjectStreamStage,
	outcome federatedPrivateObjectStreamOutcome,
	reason federatedPrivateObjectStreamReason,
) bool {
	if stage != federatedPrivateObjectStageRecipientProxy &&
		stage != federatedPrivateObjectStageSourceRead {
		return false
	}
	switch outcome {
	case federatedPrivateObjectOutcomeAccepted:
		return reason == federatedPrivateObjectReasonNone
	case federatedPrivateObjectOutcomeRejected:
		return reason == federatedPrivateObjectReasonNotFound ||
			reason == federatedPrivateObjectReasonRangeInvalid ||
			reason == federatedPrivateObjectReasonIntegrity
	case federatedPrivateObjectOutcomeInterrupted:
		return reason == federatedPrivateObjectReasonCancelled
	case federatedPrivateObjectOutcomeRetryable:
		return reason == federatedPrivateObjectReasonDependency
	default:
		return false
	}
}
