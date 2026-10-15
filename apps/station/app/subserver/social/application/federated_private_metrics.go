package application

import (
	"context"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
)

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

// ObserveDispatch maps persisted Federation transitions to bounded Social metrics.
func (s *PrivateContentService) ObserveDispatch(
	_ context.Context,
	observation federationdelivery.DispatchObservation,
) {
	if observation.PayloadKind != federationdelivery.PayloadKindSocialPrivateResource {
		return
	}
	outcome, reason := federatedPrivateDispatchMetricValues(observation)
	s.metrics.deliveryTotal.Inc("dispatcher", outcome, reason)
	s.metrics.deliveryLatency.Observe(
		observation.Latency.Seconds(),
		"dispatcher",
		outcome,
	)
}

func federatedPrivateDispatchMetricValues(
	observation federationdelivery.DispatchObservation,
) (string, string) {
	outcome := string(observation.Transition)
	reason := federatedPrivateDispatchReason(observation.Failure)
	if observation.Transition == federationdelivery.DispatchTransitionDelivered {
		reason = "none"
	}
	if !validFederatedPrivateDispatchObservation(outcome, reason) {
		reason = "protocol"
	}
	return outcome, reason
}

func validFederatedPrivateDispatchObservation(outcome string, reason string) bool {
	validReason := false
	switch reason {
	case "none", "transport", "protocol", "overloaded", "dependency",
		"integrity", "authorization", "domain", "expired":
		validReason = true
	}
	if !validReason {
		return false
	}
	switch outcome {
	case "delivered":
		return reason == "none"
	case "retrying":
		return reason != "none" && reason != "expired"
	case "terminal":
		return reason != "none"
	case "expired":
		return reason == "expired"
	default:
		return false
	}
}

func federatedPrivateDispatchReason(failure federationdelivery.FailureCode) string {
	switch failure {
	case "":
		return "none"
	case federationdelivery.FailureTransportUnavailable:
		return "transport"
	case federationdelivery.FailureInvalidResult,
		federationdelivery.FailureUnsupportedPayload:
		return "protocol"
	case federationdelivery.FailureOverloaded:
		return "overloaded"
	case federationdelivery.FailureDomainDispatch,
		federationdelivery.FailurePersistence,
		federationdelivery.FailureLeaseFenced:
		return "dependency"
	case federationdelivery.FailureInvalidFrame,
		federationdelivery.FailurePayloadHashConflict:
		return "integrity"
	case federationdelivery.FailureUnauthenticated,
		federationdelivery.FailureWrongTarget:
		return "authorization"
	case federationdelivery.FailureDomainRejected:
		return "domain"
	case federationdelivery.FailureExpired:
		return "expired"
	default:
		return "protocol"
	}
}
