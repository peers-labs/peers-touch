package infrastructure

import (
	"context"
	"time"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
)

// FederatedPrivateDeliveryStatusStore exposes Federation-owned outbox state to Social.
type FederatedPrivateDeliveryStatusStore interface {
	ReadFederatedPrivateDeliveryStatuses(
		context.Context,
		[]string,
		time.Time,
	) ([]federationdelivery.OutboxStatus, error)
}

// ReadFederatedPrivateDeliveryStatuses reads through the Federation repository.
func (s *GORMPrivateContentStore) ReadFederatedPrivateDeliveryStatuses(
	ctx context.Context,
	frameIDs []string,
	now time.Time,
) ([]federationdelivery.OutboxStatus, error) {
	repository, err := federationdelivery.NewGORMRepository(
		s.db,
		federationdelivery.SystemClock{},
	)
	if err != nil {
		return nil, err
	}
	statuses := make([]federationdelivery.OutboxStatus, 0, len(frameIDs))
	for start := 0; start < len(frameIDs); start += federationdelivery.MaxClaimBatchSize {
		end := start + federationdelivery.MaxClaimBatchSize
		if end > len(frameIDs) {
			end = len(frameIDs)
		}
		batch, err := repository.ReadOutboxStatuses(
			ctx,
			frameIDs[start:end],
			now,
		)
		if err != nil {
			return nil, err
		}
		statuses = append(statuses, batch...)
	}
	return statuses, nil
}
