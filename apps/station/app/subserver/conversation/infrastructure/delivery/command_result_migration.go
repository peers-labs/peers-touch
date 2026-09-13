package delivery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// MigrateCommandResultItemIdentities hard-cuts historical result rows to the
// endpoint/command identity used by bounded reconciliation.
func MigrateCommandResultItemIdentities(
	ctx context.Context,
	db *gorm.DB,
) error {
	if ctx == nil || db == nil {
		return fmt.Errorf(
			"migrate command-result item identities: context and database are required",
		)
	}
	var rows []DeviceQueueItemModel
	if err := db.WithContext(ctx).
		Where(
			"payload_type = ?",
			int32(chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_COMMAND_RESULT),
		).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return fmt.Errorf("load command-result Device Inbox rows: %w", err)
	}
	for index := range rows {
		if err := migrateCommandResultItemIdentity(ctx, db, &rows[index]); err != nil {
			return err
		}
	}
	return nil
}

func migrateCommandResultItemIdentity(
	ctx context.Context,
	db *gorm.DB,
	row *DeviceQueueItemModel,
) error {
	if row == nil ||
		len(row.OpaquePayload) == 0 ||
		len(row.PayloadSHA256) != sha256.Size ||
		!bytes.Equal(
			row.PayloadSHA256,
			federationdelivery.PayloadSHA256(row.OpaquePayload),
		) {
		return fmt.Errorf(
			"migrate command-result item identity: row payload is not canonically bound",
		)
	}
	var delivery chatmodel.ConversationCommandResultDelivery
	if err := proto.Unmarshal(row.OpaquePayload, &delivery); err != nil {
		return fmt.Errorf(
			"decode command-result Device Inbox row %d: %w",
			row.ID,
			err,
		)
	}
	canonicalPayload, err := proto.MarshalOptions{Deterministic: true}.Marshal(&delivery)
	if err != nil || !bytes.Equal(canonicalPayload, row.OpaquePayload) {
		return fmt.Errorf(
			"migrate command-result item identity: row %d payload is not deterministic",
			row.ID,
		)
	}
	recipient, err := valueobject.NewEndpoint(
		row.RecipientPTID,
		row.RecipientDeviceID,
	)
	if err != nil {
		return err
	}
	conversationID, err := valueobject.NewConversationID(delivery.GetConversationId())
	if err != nil {
		return err
	}
	commandID, err := valueobject.NewCommandID(delivery.GetCommandId())
	if err != nil {
		return err
	}
	if row.ConversationID != string(conversationID) ||
		delivery.GetResult() == nil ||
		delivery.GetResult().GetCommandId() != string(commandID) {
		return fmt.Errorf(
			"migrate command-result item identity: row %d has conflicting command bindings",
			row.ID,
		)
	}
	canonicalID, err := CommandResultItemID(recipient, conversationID, commandID)
	if err != nil {
		return err
	}
	if row.ItemID == canonicalID && row.IdempotencyKey == canonicalID {
		return nil
	}
	var duplicate int64
	if err := db.WithContext(ctx).
		Model(&DeviceQueueItemModel{}).
		Where("item_id = ? AND id <> ?", canonicalID, row.ID).
		Count(&duplicate).Error; err != nil {
		return err
	}
	if duplicate != 0 {
		return fmt.Errorf(
			"migrate command-result item identity: canonical ID %s is duplicated",
			canonicalID,
		)
	}
	updates := map[string]any{
		"item_id":         canonicalID,
		"idempotency_key": canonicalID,
	}
	if row.ConsumptionReceiptID != nil {
		expectedReceiptID := "device-consumed:" + row.ItemID
		if *row.ConsumptionReceiptID != expectedReceiptID {
			return fmt.Errorf(
				"migrate command-result item identity: row %d receipt is not bound to its item",
				row.ID,
			)
		}
		updates["consumption_receipt_id"] = "device-consumed:" + canonicalID
	}
	result := db.WithContext(ctx).
		Model(&DeviceQueueItemModel{}).
		Where(
			"id = ? AND item_id = ? AND idempotency_key = ?",
			row.ID,
			row.ItemID,
			row.IdempotencyKey,
		).
		Updates(updates)
	if result.Error != nil {
		return fmt.Errorf(
			"migrate command-result item identity for row %d: %w",
			row.ID,
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf(
			"migrate command-result item identity: row %d changed concurrently",
			row.ID,
		)
	}
	return nil
}
