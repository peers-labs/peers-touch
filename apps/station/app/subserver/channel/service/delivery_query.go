package service

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"gorm.io/gorm"
)

type DeliveryStatusView struct {
	ID                string
	Status            string
	ProviderMessageID string
	LastError         string
}

func (b *DurableBridge) WaitDelivery(
	ctx context.Context,
	actorPTID, bindingID, deliveryID string,
	maxWait time.Duration,
) (DeliveryStatusView, error) {
	if _, err := b.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return DeliveryStatusView{}, err
	}
	if maxWait <= 0 {
		maxWait = 10 * time.Second
	}
	deadline := time.NewTimer(maxWait)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		view, err := b.deliveryStatus(ctx, bindingID, deliveryID)
		if err != nil {
			return DeliveryStatusView{}, err
		}
		if view.Status == deliveryStatusDelivered ||
			view.Status == deliveryStatusFailed ||
			view.Status == deliveryStatusUnknown {
			return view, nil
		}
		select {
		case <-ctx.Done():
			return view, ctx.Err()
		case <-deadline.C:
			return view, nil
		case <-ticker.C:
		}
	}
}

func (b *DurableBridge) deliveryStatus(
	ctx context.Context,
	bindingID, deliveryID string,
) (DeliveryStatusView, error) {
	var record persistence.ChannelDeliveryIntent
	err := b.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", deliveryID, bindingID).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DeliveryStatusView{}, ErrBindingNotFound
	}
	if err != nil {
		return DeliveryStatusView{}, err
	}
	return DeliveryStatusView{
		ID: record.ID, Status: record.Status,
		ProviderMessageID: record.ProviderMessageID, LastError: record.LastError,
	}, nil
}
