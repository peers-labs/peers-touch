package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// Forwarded means an accepted delivery ACK, not merely an outbox insertion.
// Expiration creates a new transport attempt carrying the exact same receipt.
func (s *FeedLogService) forwardInteraction(ctx context.Context, tx delivery.Transaction, target string, receipt *model.FeedInteraction) error {
	statement := receipt.Event.Statement
	var row infrastructure.FeedInteractionRecord
	if err := tx.DB().Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
		statement.ActorPtid, statement.ChainId, statement.Sequence).Take(&row).Error; err != nil {
		return err
	}
	if row.TargetStation != target || row.HomeStation != s.localStation {
		return domain.ErrFeedWriter
	}
	if row.OutboundFrameID != "" {
		reader, err := delivery.NewGORMRepository(tx.DB(), delivery.SystemClock{})
		if err != nil {
			return err
		}
		statuses, err := reader.ReadOutboxStatuses(ctx, []string{row.OutboundFrameID}, s.now())
		if err != nil {
			return err
		}
		switch statuses[0].State {
		case delivery.OutboxStateDelivered:
			return tx.DB().Model(&row).Update("forwarded", true).Error
		case delivery.OutboxStateExpired:
			// Keep receipt bytes and author sequence; only transport identity changes.
		case delivery.OutboxStateTerminal:
			return domain.ErrFeedInvalid
		default:
			return nil
		}
	}
	row.DeliveryRevision++
	frameID, err := s.enqueueRevision(ctx, tx, target, delivery.PayloadKindSocialPublicFeedInteraction, receipt, row.DeliveryRevision)
	if err != nil {
		return err
	}
	return tx.DB().Model(&row).Updates(map[string]interface{}{
		"outbound_frame_id": frameID, "delivery_revision": row.DeliveryRevision}).Error
}
