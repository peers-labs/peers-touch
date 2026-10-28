package conversation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	notificationinfra "github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"gorm.io/gorm"
)

type productionServiceNotifications struct {
	producer *notificationinfra.TxProducer
}

type productionPublishedObjects struct {
	db *gorm.DB
}

func (d *productionPublishedObjects) ValidateObject(
	ctx context.Context,
	objectID string,
	owner valueobject.PTID,
	_ valueobject.ConversationID,
	at time.Time,
) (ports.PublishedObject, error) {
	var object ossmodel.FileMeta
	err := d.db.WithContext(ctx).
		Where("id = ? AND owner_ptid = ? AND deleted_at IS NULL", objectID, owner).
		First(&object).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ports.PublishedObject{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"production_publishing.validate_object",
			"object_id",
			"object is not an active object owned by the grant owner",
		)
	}
	if err != nil {
		return ports.PublishedObject{}, fmt.Errorf("load published object: %w", err)
	}
	if object.ExpiresAt != nil && !at.Before(*object.ExpiresAt) {
		return ports.PublishedObject{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"production_publishing.validate_object",
			"object_id",
			"object has expired",
		)
	}
	if object.Size < 0 {
		return ports.PublishedObject{}, fmt.Errorf("published object size is invalid")
	}
	return ports.PublishedObject{
		ID:        object.ID,
		Filename:  object.Name,
		MediaType: object.Mime,
		Size:      uint64(object.Size),
	}, nil
}

func (n *productionServiceNotifications) ProduceInTx(
	ctx context.Context,
	input ports.ServiceNotificationInput,
	at time.Time,
) (ports.ServiceNotificationResult, error) {
	result, err := n.producer.ProduceInTx(ctx, notificationinfra.TxInput{
		RecipientPTID:  input.RecipientPTID,
		ActorPTID:      input.ActorPTID,
		Type:           input.Type,
		Category:       input.Category,
		TargetType:     input.TargetType,
		TargetID:       input.TargetID,
		Title:          input.Title,
		Body:           input.Body,
		GroupKey:       input.GroupKey,
		IdempotencyKey: input.IdempotencyKey,
		Metadata:       input.Metadata,
	}, at)
	if err != nil {
		return ports.ServiceNotificationResult{}, err
	}
	return ports.ServiceNotificationResult{
		Produced:       result.Produced,
		NotificationID: result.NotificationID,
	}, nil
}
