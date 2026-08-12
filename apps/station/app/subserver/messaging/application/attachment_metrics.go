package application

import (
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
)

func publishAttachmentMetricSnapshot(snapshot *messaging.AttachmentMetricsSnapshot) {
	if snapshot == nil {
		return
	}
	provider := metrics.Get()
	eventGauge := provider.Gauge(
		"messaging_attachment_audit_events",
		"Durable attachment lifecycle audit events",
		"action",
		"outcome",
	)
	byteGauge := provider.Gauge(
		"messaging_attachment_audit_bytes",
		"Durable attachment lifecycle bytes",
		"action",
		"outcome",
	)
	for _, event := range snapshot.Events {
		eventGauge.Set(float64(event.Count), event.Action, event.Outcome)
		byteGauge.Set(float64(event.Bytes), event.Action, event.Outcome)
	}
	provider.Gauge(
		"messaging_attachment_active_uploads",
		"Current queued or transferring attachment uploads",
	).Set(float64(snapshot.ActiveUploads))
	objectGauge := provider.Gauge(
		"messaging_attachment_objects",
		"Current attachment objects by lifecycle state",
		"state",
	)
	objectGauge.Set(
		float64(snapshot.CompleteUnattachedObjects),
		messaging.AttachmentObjectStateCompleteUnattached,
	)
	objectGauge.Set(
		float64(snapshot.AttachedObjects),
		messaging.AttachmentObjectStateAttached,
	)
}
