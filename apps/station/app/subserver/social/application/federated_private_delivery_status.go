package application

import (
	"context"
	"sort"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *PrivateContentService) federatedPrivateDeliveryStatus(
	ctx context.Context,
	read *infrastructure.PrivatePostReadModel,
	viewerPTID string,
) (*privatecontentpb.FederatedPrivateDeliveryStatus, error) {
	if read == nil || viewerPTID != read.Post.AuthorPTID {
		return nil, nil
	}
	localities, err := decodePersistedRecipientLocalities(read.PrepareBinding)
	if err != nil {
		return nil, err
	}
	frameIDs := federatedPrivatePostFrameIDs(
		s.localStationPeerID,
		read.Post.ContentID,
		localities,
	)
	if len(frameIDs) == 0 {
		return &privatecontentpb.FederatedPrivateDeliveryStatus{
			State: privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_NOT_REQUIRED,
		}, nil
	}
	statusStore, ok := s.store.(infrastructure.FederatedPrivateDeliveryStatusStore)
	if !ok {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.delivery_status",
			"delivery_status_store",
			"is unavailable",
		)
	}
	statuses, err := statusStore.ReadFederatedPrivateDeliveryStatuses(
		ctx,
		frameIDs,
		s.now(),
	)
	if err != nil {
		s.metrics.reconcileTotal.Inc("rejected", "outbox")
		return nil, mapPrivateStoreError(
			"social.private_content.delivery_status",
			err,
		)
	}
	projected, err := aggregateFederatedPrivateDeliveryStatuses(statuses)
	if err != nil {
		s.metrics.reconcileTotal.Inc("rejected", "outbox")
		return nil, err
	}
	s.metrics.reconcileTotal.Inc("accepted", "delivery_status")
	return projected, nil
}

func federatedPrivatePostFrameIDs(
	localStationPeerID string,
	contentID string,
	localities []socialdomain.RecipientLocality,
) []string {
	frameIDs := make([]string, 0, len(localities))
	seen := make(map[string]struct{}, len(localities))
	for _, locality := range localities {
		if locality.HomeStationPeerID == localStationPeerID {
			continue
		}
		deliveryID := deterministicPrivateID(
			"federated-resource",
			contentID,
			locality.ActorPTID,
		)
		identity := deterministicPrivateID(
			"frame",
			localStationPeerID,
			locality.HomeStationPeerID,
			deliveryID,
		)
		frameID := "social-private-frame:" + identity
		if _, exists := seen[frameID]; exists {
			continue
		}
		seen[frameID] = struct{}{}
		frameIDs = append(frameIDs, frameID)
	}
	sort.Strings(frameIDs)
	return frameIDs
}

func aggregateFederatedPrivateDeliveryStatuses(
	statuses []federationdelivery.OutboxStatus,
) (*privatecontentpb.FederatedPrivateDeliveryStatus, error) {
	projected := &privatecontentpb.FederatedPrivateDeliveryStatus{
		TotalCount: uint32(len(statuses)),
	}
	var nextAttemptAt time.Time
	pendingCount := uint32(0)
	for _, status := range statuses {
		switch status.State {
		case federationdelivery.OutboxStateDelivered:
			projected.DeliveredCount++
		case federationdelivery.OutboxStateRetryWait:
			projected.RetryingCount++
			nextAttemptAt = earlierNonZero(nextAttemptAt, status.NextAttemptAt)
		case federationdelivery.OutboxStateLeased:
			if status.AttemptCount > 1 {
				projected.RetryingCount++
			} else {
				pendingCount++
			}
		case federationdelivery.OutboxStatePending:
			pendingCount++
		case federationdelivery.OutboxStateTerminal:
			projected.TerminalCount++
		case federationdelivery.OutboxStateExpired:
			projected.ExpiredCount++
		default:
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				"social.private_content.delivery_status",
				"outbox_state",
				"is unsupported",
			)
		}
	}
	switch {
	case projected.TerminalCount > 0:
		projected.State = privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_TERMINAL
	case projected.ExpiredCount > 0:
		projected.State = privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_EXPIRED
	case projected.RetryingCount > 0:
		projected.State = privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_RETRYING
	case pendingCount > 0:
		projected.State = privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_PENDING
	default:
		projected.State = privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_DELIVERED
	}
	if !nextAttemptAt.IsZero() {
		projected.NextAttemptAt = timestamppb.New(nextAttemptAt.UTC())
	}
	return projected, nil
}

func earlierNonZero(current time.Time, candidate time.Time) time.Time {
	if candidate.IsZero() || (!current.IsZero() && !candidate.Before(current)) {
		return current
	}
	return candidate
}
