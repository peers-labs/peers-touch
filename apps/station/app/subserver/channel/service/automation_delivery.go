package service

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"gorm.io/gorm"
)

func (b *DurableBridge) markAutomationDelivery(
	ctx context.Context,
	inboundID, deliveryID, status, errorMessage string,
	at time.Time,
) {
	if inboundID == "" {
		return
	}
	var run persistence.ChannelAutomationRun
	if err := b.db.WithContext(ctx).
		Where("inbound_id = ?", inboundID).First(&run).Error; err != nil {
		return
	}
	runStatus := status
	if status == deliveryStatusDelivered {
		runStatus = "delivered"
	} else if status == deliveryStatusFailed || status == deliveryStatusUnknown {
		runStatus = "failed"
	}
	_ = b.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.ChannelAutomationRun{}).
			Where("id = ?", run.ID).
			Updates(map[string]any{
				"delivery_id": deliveryID, "status": runStatus,
				"error_message": redactDiagnostic(errorMessage), "updated_at": at,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.ChannelAutomation{}).
			Where("id = ?", run.AutomationID).
			Updates(map[string]any{
				"last_run_status": runStatus, "last_run_at": at,
				"last_error": redactDiagnostic(errorMessage), "updated_at": at,
			}).Error
	})
}
