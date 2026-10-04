package application

import (
	"testing"
	"time"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

func TestFederatedPrivateReconcileAggregatesDurableDeliveryState(t *testing.T) {
	now := time.Unix(1_800_000_000, 0).UTC()
	tests := []struct {
		name       string
		statuses   []federationdelivery.OutboxStatus
		want       privatecontentpb.FederatedPrivateDeliveryState
		wantRetry  uint32
		wantFailed uint32
	}{
		{
			name: "pending",
			statuses: []federationdelivery.OutboxStatus{{
				FrameID: "frame-1",
				State:   federationdelivery.OutboxStatePending,
			}},
			want: privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_PENDING,
		},
		{
			name: "retrying",
			statuses: []federationdelivery.OutboxStatus{{
				FrameID:       "frame-1",
				State:         federationdelivery.OutboxStateRetryWait,
				AttemptCount:  2,
				NextAttemptAt: now.Add(time.Second),
			}},
			want:      privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_RETRYING,
			wantRetry: 1,
		},
		{
			name: "terminal wins over pending",
			statuses: []federationdelivery.OutboxStatus{
				{FrameID: "frame-1", State: federationdelivery.OutboxStatePending},
				{FrameID: "frame-2", State: federationdelivery.OutboxStateTerminal},
			},
			want:       privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_TERMINAL,
			wantFailed: 1,
		},
		{
			name: "delivered",
			statuses: []federationdelivery.OutboxStatus{{
				FrameID: "frame-1",
				State:   federationdelivery.OutboxStateDelivered,
			}},
			want: privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_DELIVERED,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status, err := aggregateFederatedPrivateDeliveryStatuses(test.statuses)
			if err != nil {
				t.Fatal(err)
			}
			if status.GetState() != test.want ||
				status.GetRetryingCount() != test.wantRetry ||
				status.GetTerminalCount() != test.wantFailed ||
				status.GetTotalCount() != uint32(len(test.statuses)) {
				t.Fatalf("delivery status = %+v", status)
			}
		})
	}
}

func TestFederatedPrivateConflictRejectsUnknownOutboxState(t *testing.T) {
	_, err := aggregateFederatedPrivateDeliveryStatuses(
		[]federationdelivery.OutboxStatus{{
			FrameID: "frame-1",
			State:   federationdelivery.OutboxState("unknown"),
		}},
	)
	if err == nil {
		t.Fatal("unknown outbox state was accepted")
	}
}

func TestFederatedPrivateReconcileMapsUnexpectedRetryFailureToProtocol(t *testing.T) {
	outcome, reason := federatedPrivateDispatchMetricValues(
		federationdelivery.DispatchObservation{
			PayloadKind: federationdelivery.PayloadKindSocialPrivateResource,
			Transition:  federationdelivery.DispatchTransitionRetrying,
			Failure:     federationdelivery.FailureExpired,
		},
	)
	if outcome != "retrying" || reason != "protocol" {
		t.Fatalf("metric tuple = %s/%s", outcome, reason)
	}
}
