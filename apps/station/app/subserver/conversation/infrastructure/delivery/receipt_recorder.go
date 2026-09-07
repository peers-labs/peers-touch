package delivery

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ReceiptRecorder records exact device consumption against canonical
// Conversation events and Device Inbox items.
type ReceiptRecorder struct {
	db              *gorm.DB
	sqliteMutex     sync.Mutex
	serializeSQLite bool
}

// NewReceiptRecorder constructs a canonical delivery-receipt persistence adapter.
func NewReceiptRecorder(db *gorm.DB) (*ReceiptRecorder, error) {
	if db == nil {
		return nil, interaction.NewError(
			interaction.ErrorCodeInvalidArgument,
			"delivery_receipt_recorder.new",
			"database",
			"is required",
		)
	}

	return &ReceiptRecorder{
		db:              db,
		serializeSQLite: db.Dialector.Name() == "sqlite",
	}, nil
}

// Record validates and persists one exact receipt, then derives the delivery
// aggregate and originator from canonical CA-W2 state.
func (r *ReceiptRecorder) Record(
	ctx context.Context,
	receipt interaction.DeliveryReceipt,
) (interaction.DeliveryRecordResult, error) {
	itemID, err := validateReceipt(receipt)
	if err != nil {
		return interaction.DeliveryRecordResult{}, err
	}
	receipt.ConsumedAt = receipt.ConsumedAt.UTC().Truncate(persistenceTimestampPrecision)

	var recorded interaction.DeliveryRecordResult
	err = r.transaction(ctx, func(tx *gorm.DB) error {
		item, err := lockReceiptItem(tx, itemID)
		if err != nil {
			return err
		}
		if err := validateReceiptItem(item, receipt); err != nil {
			return err
		}
		event, err := loadReceiptEvent(tx, receipt.EventID)
		if err != nil {
			return err
		}
		if err := validateReceiptEvent(event, receipt); err != nil {
			return err
		}

		replay, err := persistExactReceipt(tx, item, receipt)
		if err != nil {
			return err
		}
		aggregate, err := loadDeliveryAggregate(tx, event)
		if err != nil {
			return err
		}
		recorded = interaction.DeliveryRecordResult{
			Aggregate:  aggregate,
			Originator: event.Actor.Actor,
			Replay:     replay,
		}

		return nil
	})
	if err != nil {
		return interaction.DeliveryRecordResult{}, err
	}

	return recorded, nil
}

const persistenceTimestampPrecision = 1000

func (r *ReceiptRecorder) transaction(
	ctx context.Context,
	fn func(*gorm.DB) error,
) error {
	if r.serializeSQLite {
		r.sqliteMutex.Lock()
		defer r.sqliteMutex.Unlock()
	}
	err := r.db.WithContext(ctx).Transaction(fn)
	if err == nil || interaction.CodeOf(err) != "" {
		return err
	}

	return interaction.WrapError(
		interaction.ErrorCodePersistence,
		"delivery_receipt_recorder.record",
		err,
	)
}

func validateReceipt(receipt interaction.DeliveryReceipt) (string, error) {
	const prefix = "device-consumed:"
	itemID := strings.TrimPrefix(receipt.ReceiptID, prefix)
	if itemID == receipt.ReceiptID ||
		strings.TrimSpace(itemID) == "" ||
		receipt.ReceiptID != prefix+itemID ||
		receipt.ConversationID == "" ||
		receipt.EventID == "" ||
		receipt.Consumer.Validate() != nil ||
		receipt.EventSequence == 0 ||
		receipt.LaneSequence <= 0 ||
		receipt.PayloadHash.IsZero() ||
		receipt.ConsumedAt.IsZero() {
		return "", interaction.NewError(
			interaction.ErrorCodeInvalidArgument,
			"delivery_receipt_recorder.record",
			"receipt",
			"is incomplete or malformed",
		)
	}

	return itemID, nil
}

func lockReceiptItem(
	tx *gorm.DB,
	itemID string,
) (*DeviceQueueItemModel, error) {
	var item DeviceQueueItemModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&item, "item_id = ?", itemID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, receiptIntegrityError(
			"item_id",
			"does not identify a canonical Device Inbox item",
		)
	}
	if err != nil {
		return nil, err
	}

	return &item, nil
}

func validateReceiptItem(
	item *DeviceQueueItemModel,
	receipt interaction.DeliveryReceipt,
) error {
	if item.ItemID == "" ||
		item.ConversationID != string(receipt.ConversationID) ||
		item.EventID != string(receipt.EventID) ||
		item.EventSequence != uint64(receipt.EventSequence) ||
		item.RecipientPTID != string(receipt.Consumer.Actor) ||
		item.RecipientDeviceID != string(receipt.Consumer.Device) ||
		item.LaneSequence != receipt.LaneSequence ||
		item.PayloadType != storagePayloadTypeConversationEvent ||
		!bytes.Equal(item.PayloadSHA256, receipt.PayloadHash.Bytes()) ||
		!payloadMatches(item) {
		return receiptIntegrityError(
			"receipt",
			"does not match the canonical item, conversation, event, sequence, payload, and consumer tuple",
		)
	}
	switch item.State {
	case storageStateClaimed, storageStateConsumed, storageStateAcked:
		return nil
	default:
		return receiptIntegrityError(
			"state",
			"does not prove a durably consumed Device Inbox item",
		)
	}
}

const storagePayloadTypeConversationEvent = int32(1)

func loadReceiptEvent(
	tx *gorm.DB,
	eventID valueobject.EventID,
) (domainevent.Record, error) {
	var model persistence.ConversationEventModel
	err := tx.First(&model, "event_id = ?", string(eventID)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainevent.Record{}, receiptIntegrityError(
			"event_id",
			"does not identify a canonical Conversation event",
		)
	}
	if err != nil {
		return domainevent.Record{}, err
	}

	var record domainevent.Record
	if err := json.Unmarshal(model.DomainSnapshot, &record); err != nil {
		return domainevent.Record{}, fmt.Errorf(
			"decode canonical Conversation event: %w",
			err,
		)
	}
	record.HashScheme = domainevent.HashScheme(model.HashScheme)
	record.EncodedBytes = append([]byte(nil), model.EventBytes...)
	rehydrated, err := domainevent.Rehydrate(record)
	if err != nil {
		return domainevent.Record{}, receiptIntegrityError(
			"event",
			"canonical Conversation event failed integrity validation",
		)
	}
	if rehydrated.ID != valueobject.EventID(model.EventID) ||
		rehydrated.ConversationID != valueobject.ConversationID(model.ConversationID) ||
		rehydrated.Sequence != valueobject.Sequence(model.Sequence) ||
		rehydrated.Actor.Actor != valueobject.PTID(model.ActorPTID) ||
		rehydrated.Actor.Device != valueobject.DeviceID(model.ActorDeviceID) ||
		!bytes.Equal(rehydrated.Hash.Bytes(), model.EventHash) ||
		!rehydrated.CommittedAt.Equal(model.CommittedAt) {
		return domainevent.Record{}, receiptIntegrityError(
			"event",
			"indexed Conversation event state disagrees with its canonical record",
		)
	}

	return rehydrated, nil
}

func validateReceiptEvent(
	event domainevent.Record,
	receipt interaction.DeliveryReceipt,
) error {
	if event.ID != receipt.EventID ||
		event.ConversationID != receipt.ConversationID ||
		event.Sequence != receipt.EventSequence ||
		event.Actor.Actor == "" ||
		len(event.DeliveryCommitments) == 0 {
		return receiptIntegrityError(
			"event",
			"does not match the receipt or contain a committed delivery set",
		)
	}

	return nil
}

func persistExactReceipt(
	tx *gorm.DB,
	item *DeviceQueueItemModel,
	receipt interaction.DeliveryReceipt,
) (bool, error) {
	if item.ConsumptionReceiptID != nil {
		if *item.ConsumptionReceiptID != receipt.ReceiptID ||
			item.ConsumedAt == nil ||
			!item.ConsumedAt.Equal(receipt.ConsumedAt) {
			return false, interaction.NewError(
				interaction.ErrorCodeIdempotencyConflict,
				"delivery_receipt_recorder.record",
				"receipt_id",
				"already identifies a different persisted receipt",
			)
		}

		return true, nil
	}

	result := tx.Model(&DeviceQueueItemModel{}).
		Where("item_id = ? AND consumption_receipt_id IS NULL", item.ItemID).
		Updates(map[string]any{
			"consumption_receipt_id": receipt.ReceiptID,
			"consumed_at":            receipt.ConsumedAt,
		})
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected != 1 {
		return false, interaction.NewError(
			interaction.ErrorCodeIdempotencyConflict,
			"delivery_receipt_recorder.record",
			"receipt_id",
			"was concurrently recorded with different receipt data",
		)
	}
	item.ConsumptionReceiptID = &receipt.ReceiptID
	consumedAt := receipt.ConsumedAt
	item.ConsumedAt = &consumedAt

	return false, nil
}

func loadDeliveryAggregate(
	tx *gorm.DB,
	event domainevent.Record,
) (interaction.DeliveryAggregate, error) {
	requiredCount := len(event.DeliveryCommitments)
	if requiredCount == 0 || requiredCount > math.MaxUint32 {
		return interaction.DeliveryAggregate{}, receiptIntegrityError(
			"delivery_commitments",
			"contains an invalid required device count",
		)
	}

	var items []DeviceQueueItemModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"conversation_id = ? AND event_id = ? AND payload_type = ?",
			string(event.ConversationID),
			string(event.ID),
			storagePayloadTypeConversationEvent,
		).
		Order("recipient_ptid ASC, recipient_device_id ASC").
		Find(&items).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	if len(items) == 0 || len(items) > requiredCount {
		return interaction.DeliveryAggregate{}, receiptIntegrityError(
			"device_queue_items",
			"does not match the committed delivery-set cardinality",
		)
	}

	var devices []persistence.ConversationMemberDeviceModel
	if err := tx.Where(
		"conversation_id = ?",
		string(event.ConversationID),
	).Find(&devices).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	devicesByEndpoint := make(map[string]persistence.ConversationMemberDeviceModel, len(devices))
	for _, device := range devices {
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(device.PTID),
			Device: valueobject.DeviceID(device.DeviceID),
		}
		devicesByEndpoint[endpoint.Key()] = device
	}

	seen := make(map[string]struct{}, len(items))
	var consumedCount uint32
	var revokedCount uint32
	for index := range items {
		item := &items[index]
		if item.EventSequence != uint64(event.Sequence) || !payloadMatches(item) {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"device_queue_items",
				"contains an item that disagrees with the canonical event",
			)
		}
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(item.RecipientPTID),
			Device: valueobject.DeviceID(item.RecipientDeviceID),
		}
		key := endpoint.Key()
		if _, duplicate := seen[key]; duplicate {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"device_queue_items",
				"contains duplicate endpoint deliveries for one event",
			)
		}
		seen[key] = struct{}{}
		device, exists := devicesByEndpoint[key]
		if !exists {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"conversation_member_devices",
				"is missing a required delivery endpoint",
			)
		}
		if item.ConsumptionReceiptID != nil {
			consumedCount++
		} else if !device.Active {
			revokedCount++
		}
	}

	var readCount int64
	if err := tx.Model(&persistence.ConversationReadCursorModel{}).
		Where(
			"conversation_id = ? AND ptid != ? AND last_read_sequence >= ?",
			string(event.ConversationID),
			string(event.Actor.Actor),
			uint64(event.Sequence),
		).
		Count(&readCount).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	required := uint32(requiredCount)

	return interaction.DeliveryAggregate{
		ConversationID:      event.ConversationID,
		EventID:             event.ID,
		EventSequence:       event.Sequence,
		RequiredDeviceCount: required,
		ConsumedDeviceCount: consumedCount,
		RevokedDeviceCount:  revokedCount,
		Delivered:           consumedCount > 0,
		FullyDelivered:      consumedCount+revokedCount == required,
		Read:                readCount > 0,
	}, nil
}

func receiptIntegrityError(field string, message string) error {
	return interaction.NewError(
		interaction.ErrorCodeIntegrityFailed,
		"delivery_receipt_recorder.record",
		field,
		message,
	)
}

var _ interaction.DeliveryReceiptRecorder = (*ReceiptRecorder)(nil)
