package application

import "github.com/peers-labs/peers-touch/station/frame/core/metrics"

const (
	federatedPrivateMetricPreKeyClaimTotal   = "social_cross_station_prekey_claim_total"
	federatedPrivateMetricPreKeyClaimLatency = "social_cross_station_prekey_claim_latency_seconds"
	federatedPrivateMetricDeliveryTotal      = "social_cross_station_delivery_total"
	federatedPrivateMetricDeliveryLatency    = "social_cross_station_delivery_latency_seconds"
	federatedPrivateMetricInteractionTotal   = "social_cross_station_interaction_total"
	federatedPrivateMetricInteractionLatency = "social_cross_station_interaction_latency_seconds"
	federatedPrivateMetricReplayTotal        = "social_cross_station_replay_total"
	federatedPrivateMetricRevocationTotal    = "social_cross_station_revocation_total"
	federatedPrivateMetricReconcileTotal     = "social_cross_station_reconcile_total"
	federatedPrivateMetricRecoveryTotal      = "social_cross_station_recovery_total"
)

type federatedPrivateMetrics struct {
	preKeyClaimTotal   metrics.Counter
	preKeyClaimLatency metrics.Histogram
	deliveryTotal      metrics.Counter
	deliveryLatency    metrics.Histogram
	interactionTotal   metrics.Counter
	interactionLatency metrics.Histogram
	replayTotal        metrics.Counter
	revocationTotal    metrics.Counter
	reconcileTotal     metrics.Counter
	recoveryTotal      metrics.Counter
}

func newFederatedPrivateMetrics() federatedPrivateMetrics {
	provider := metrics.Get()
	latencyBuckets := []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30}
	return federatedPrivateMetrics{
		preKeyClaimTotal: provider.Counter(
			federatedPrivateMetricPreKeyClaimTotal,
			"Cross-Station private Social Content PreKey claim attempts",
			"outcome",
			"reason",
		),
		preKeyClaimLatency: provider.Histogram(
			federatedPrivateMetricPreKeyClaimLatency,
			"Cross-Station private Social Content PreKey claim latency",
			latencyBuckets,
			"outcome",
		),
		deliveryTotal: provider.Counter(
			federatedPrivateMetricDeliveryTotal,
			"Cross-Station private Social delivery transitions",
			"operation",
			"outcome",
			"reason",
		),
		deliveryLatency: provider.Histogram(
			federatedPrivateMetricDeliveryLatency,
			"Cross-Station private Social delivery latency",
			latencyBuckets,
			"stage",
			"outcome",
		),
		interactionTotal: provider.Counter(
			federatedPrivateMetricInteractionTotal,
			"Cross-Station private Social interaction transitions",
			"operation",
			"outcome",
			"reason",
		),
		interactionLatency: provider.Histogram(
			federatedPrivateMetricInteractionLatency,
			"Cross-Station private Social interaction latency",
			latencyBuckets,
			"operation",
			"outcome",
		),
		replayTotal: provider.Counter(
			federatedPrivateMetricReplayTotal,
			"Cross-Station private Social replay dispositions",
			"payload_kind",
			"outcome",
			"reason",
		),
		revocationTotal: provider.Counter(
			federatedPrivateMetricRevocationTotal,
			"Cross-Station private Social revocation transitions",
			"operation",
			"outcome",
			"reason",
		),
		reconcileTotal: provider.Counter(
			federatedPrivateMetricReconcileTotal,
			"Cross-Station private Social reconciliation transitions",
			"outcome",
			"reason",
		),
		recoveryTotal: provider.Counter(
			federatedPrivateMetricRecoveryTotal,
			"Cross-Station private Social recovery transitions",
			"outcome",
			"reason",
		),
	}
}
