package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type DeviceQueueLaneModel struct {
	RecipientPTID       string `gorm:"column:recipient_ptid;size:255;primaryKey"`
	RecipientDeviceID   string `gorm:"column:recipient_device_id;size:255;primaryKey"`
	NextSequence        int64  `gorm:"column:next_sequence;not null"`
	AckedThrough        int64  `gorm:"column:acked_through;not null"`
	ActiveConsumerID    string `gorm:"column:active_consumer_id;size:255"`
	ActiveConsumerEpoch uint64 `gorm:"column:active_consumer_epoch;not null"`
}

func (*DeviceQueueLaneModel) TableName() string {
	return "device_queue_lanes"
}

type DeviceQueueItemModel struct {
	ID                 uint       `gorm:"column:id;primaryKey"`
	ItemID             string     `gorm:"column:item_id;size:64;uniqueIndex"`
	RecipientPTID      string     `gorm:"column:recipient_ptid;size:255;uniqueIndex:idx_device_queue_sequence;uniqueIndex:idx_device_queue_idempotency"`
	RecipientDeviceID  string     `gorm:"column:recipient_device_id;size:255;uniqueIndex:idx_device_queue_sequence;uniqueIndex:idx_device_queue_idempotency"`
	LaneSequence       int64      `gorm:"column:lane_sequence;uniqueIndex:idx_device_queue_sequence"`
	IdempotencyKey     string     `gorm:"column:idempotency_key;size:255;uniqueIndex:idx_device_queue_idempotency"`
	EventID            string     `gorm:"column:event_id;size:64;index"`
	ConversationID     string     `gorm:"column:conversation_id;size:64;index"`
	PayloadType        int32      `gorm:"column:payload_type"`
	OpaquePayload      []byte     `gorm:"column:opaque_payload;type:bytea"`
	PayloadSHA256      []byte     `gorm:"column:payload_sha256;type:bytea"`
	State              int32      `gorm:"column:state;index"`
	AttemptCount       uint32     `gorm:"column:attempt_count"`
	LeaseConsumerID    string     `gorm:"column:lease_consumer_id;size:255"`
	LeaseConsumerEpoch uint64     `gorm:"column:lease_consumer_epoch"`
	LeaseExpiresAt     *time.Time `gorm:"column:lease_expires_at;index"`
	FirstQueuedAt      time.Time  `gorm:"column:first_queued_at"`
	NextAttemptAt      time.Time  `gorm:"column:next_attempt_at;index"`
	ExpiresAt          *time.Time `gorm:"column:expires_at"`
	ConsumedAt         *time.Time `gorm:"column:consumed_at"`
	AckedAt            *time.Time `gorm:"column:acked_at"`
	LastErrorCode      string     `gorm:"column:last_error_code;size:128"`
}

func (*DeviceQueueItemModel) TableName() string {
	return "device_queue_items"
}

type QueueRepository struct {
	db     *gorm.DB
	limits messaging.QueueLimits
}

func NewQueueRepository(db *gorm.DB, limits messaging.QueueLimits) (*QueueRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: queue database is required")
	}
	if limits.MaxUnackedItems <= 0 || limits.MaxUnackedBytes <= 0 {
		return nil, fmt.Errorf("messaging: positive device queue limits are required")
	}

	return &QueueRepository{db: db, limits: limits}, nil
}

func (r *QueueRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&DeviceQueueLaneModel{}, &DeviceQueueItemModel{})
}

func (r *QueueRepository) Enqueue(
	ctx context.Context,
	item *chat.DeviceQueueItem,
) (*chat.DeviceQueueItem, error) {
	if item == nil || item.Recipient == nil {
		return nil, fmt.Errorf("messaging: recipient endpoint is required")
	}
	if item.Recipient.Ptid == "" || item.Recipient.DeviceId == "" {
		return nil, fmt.Errorf("messaging: complete recipient endpoint is required")
	}
	if item.IdempotencyKey == "" {
		return nil, fmt.Errorf("messaging: idempotency key is required")
	}
	if len(item.PayloadSha256) != sha256.Size {
		return nil, fmt.Errorf("messaging: payload SHA-256 must be %d bytes", sha256.Size)
	}
	payloadHash := sha256.Sum256(item.OpaquePayload)
	if !bytes.Equal(payloadHash[:], item.PayloadSha256) {
		return nil, messaging.ErrPayloadHash
	}

	var persisted *chat.DeviceQueueItem
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lane, err := lockOrCreateLane(
			tx,
			item.Recipient.Ptid,
			item.Recipient.DeviceId,
		)
		if err != nil {
			return err
		}

		var existing DeviceQueueItemModel
		err = tx.
			Where(
				"recipient_ptid = ? AND recipient_device_id = ? AND idempotency_key = ?",
				item.Recipient.Ptid,
				item.Recipient.DeviceId,
				item.IdempotencyKey,
			).
			First(&existing).Error
		if err == nil {
			persisted = existing.toProto()
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := r.checkQuota(tx, item.Recipient.Ptid, item.Recipient.DeviceId, int64(len(item.OpaquePayload))); err != nil {
			return err
		}

		lane.NextSequence++
		if err := tx.Save(lane).Error; err != nil {
			return err
		}

		model := modelFromProto(item)
		if model.ItemID == "" {
			model.ItemID = uuid.NewString()
		}
		model.LaneSequence = lane.NextSequence
		model.State = int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_PENDING)
		model.FirstQueuedAt = time.Now().UTC()
		model.NextAttemptAt = model.FirstQueuedAt
		if err := tx.Create(model).Error; err != nil {
			return err
		}
		persisted = model.toProto()
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("messaging: enqueue device queue item: %w", err)
	}

	return persisted, nil
}

func (r *QueueRepository) Claim(
	ctx context.Context,
	ptid string,
	deviceID string,
	consumerID string,
	expectedConsumerEpoch uint64,
	afterLaneSequence int64,
	limit int,
	now time.Time,
	leaseDuration time.Duration,
) (*messaging.ClaimResult, error) {
	if ptid == "" || deviceID == "" || consumerID == "" {
		return nil, fmt.Errorf("messaging: claim requires endpoint and consumer")
	}
	if limit <= 0 || limit > 100 {
		return nil, fmt.Errorf("messaging: claim limit must be between 1 and 100")
	}
	if leaseDuration <= 0 {
		return nil, fmt.Errorf("messaging: lease duration must be positive")
	}

	result := &messaging.ClaimResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lane, err := lockOrCreateLane(tx, ptid, deviceID)
		if err != nil {
			return err
		}
		if expectedConsumerEpoch != 0 &&
			expectedConsumerEpoch != lane.ActiveConsumerEpoch {
			return messaging.ErrConsumerFenced
		}
		if lane.ActiveConsumerID != consumerID {
			lane.ActiveConsumerID = consumerID
			lane.ActiveConsumerEpoch++
			if err := tx.Save(lane).Error; err != nil {
				return err
			}
		}
		result.ConsumerEpoch = lane.ActiveConsumerEpoch
		result.LaneHead = lane.NextSequence
		result.AckedThrough = lane.AckedThrough

		var models []DeviceQueueItemModel
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"recipient_ptid = ? AND recipient_device_id = ? AND lane_sequence > ? AND lane_sequence > ?",
				ptid,
				deviceID,
				lane.AckedThrough,
				afterLaneSequence,
			).
			Where(
				"(state = ? OR (state = ? AND next_attempt_at <= ?) OR (state = ? AND lease_expires_at <= ?))",
				int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_PENDING),
				int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_RETRY_WAIT),
				now,
				int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_CLAIMED),
				now,
			).
			Order("lane_sequence ASC").
			Limit(limit).
			Find(&models).Error
		if err != nil {
			return err
		}
		if len(models) == 0 {
			return nil
		}
		if models[0].LaneSequence != lane.AckedThrough+1 {
			return nil
		}

		leaseExpiresAt := now.Add(leaseDuration)
		for index := range models {
			if index > 0 &&
				models[index].LaneSequence != models[index-1].LaneSequence+1 {
				break
			}
			model := &models[index]
			model.State = int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_CLAIMED)
			model.LeaseConsumerID = consumerID
			model.LeaseConsumerEpoch = result.ConsumerEpoch
			model.LeaseExpiresAt = &leaseExpiresAt
			model.AttemptCount++
			if err := tx.Save(model).Error; err != nil {
				return err
			}
			result.Items = append(result.Items, model.toProto())
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

func (r *QueueRepository) Acknowledge(
	ctx context.Context,
	ptid string,
	deviceID string,
	itemID string,
	laneSequence int64,
	consumerEpoch uint64,
	payloadSHA256 []byte,
	now time.Time,
) (int64, error) {
	if ptid == "" || deviceID == "" || itemID == "" {
		return 0, fmt.Errorf("messaging: acknowledge requires endpoint and item")
	}
	if laneSequence <= 0 {
		return 0, fmt.Errorf("messaging: acknowledge requires a positive lane sequence")
	}
	if len(payloadSHA256) != sha256.Size {
		return 0, fmt.Errorf("messaging: payload SHA-256 must be %d bytes", sha256.Size)
	}

	var ackedThrough int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lane, err := lockOrCreateLane(tx, ptid, deviceID)
		if err != nil {
			return err
		}
		if consumerEpoch == 0 || consumerEpoch != lane.ActiveConsumerEpoch {
			return messaging.ErrConsumerFenced
		}

		var item DeviceQueueItemModel
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("item_id = ?", itemID).
			First(&item).Error
		if err != nil {
			return err
		}
		if item.RecipientPTID != ptid || item.RecipientDeviceID != deviceID {
			return messaging.ErrQueueItemOwner
		}
		if item.LaneSequence != laneSequence ||
			laneSequence != lane.AckedThrough+1 {
			return messaging.ErrQueueItemOrder
		}
		if item.LeaseConsumerEpoch != consumerEpoch {
			return messaging.ErrConsumerFenced
		}
		if item.State != int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_CLAIMED) {
			return messaging.ErrQueueItemState
		}
		if !bytes.Equal(item.PayloadSHA256, payloadSHA256) {
			return messaging.ErrPayloadHash
		}

		item.State = int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_ACKED)
		item.ConsumedAt = &now
		item.AckedAt = &now
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		lane.AckedThrough = laneSequence
		if err := tx.Save(lane).Error; err != nil {
			return err
		}
		ackedThrough = lane.AckedThrough

		return nil
	})
	if err != nil {
		return 0, err
	}

	return ackedThrough, nil
}

func (r *QueueRepository) Reject(
	ctx context.Context,
	ptid string,
	deviceID string,
	itemID string,
	laneSequence int64,
	consumerEpoch uint64,
	decision messaging.RejectDecision,
	now time.Time,
) (*chat.DeviceQueueItem, error) {
	if ptid == "" || deviceID == "" || itemID == "" {
		return nil, fmt.Errorf("messaging: reject requires endpoint and item")
	}
	if laneSequence <= 0 {
		return nil, fmt.Errorf("messaging: reject requires a positive lane sequence")
	}
	if decision.ErrorCode == "" {
		return nil, fmt.Errorf("messaging: reject requires an error code")
	}
	if decision.Retryable {
		if decision.MaxAttempts == 0 {
			return nil, fmt.Errorf("messaging: retryable reject requires max attempts")
		}
		if decision.BaseRetryDelay <= 0 ||
			decision.MaxRetryDelay < decision.BaseRetryDelay {
			return nil, fmt.Errorf("messaging: retryable reject requires valid backoff limits")
		}
	}

	var rejected *chat.DeviceQueueItem
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lane, err := lockOrCreateLane(tx, ptid, deviceID)
		if err != nil {
			return err
		}
		if consumerEpoch == 0 || consumerEpoch != lane.ActiveConsumerEpoch {
			return messaging.ErrConsumerFenced
		}

		var item DeviceQueueItemModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("item_id = ?", itemID).
			First(&item).Error; err != nil {
			return err
		}
		if item.RecipientPTID != ptid || item.RecipientDeviceID != deviceID {
			return messaging.ErrQueueItemOwner
		}
		if item.LaneSequence != laneSequence || laneSequence != lane.AckedThrough+1 {
			return messaging.ErrQueueItemOrder
		}
		if item.LeaseConsumerEpoch != consumerEpoch {
			return messaging.ErrConsumerFenced
		}
		if item.State != int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_CLAIMED) {
			return messaging.ErrQueueItemState
		}

		item.LastErrorCode = decision.ErrorCode
		item.LeaseConsumerID = ""
		item.LeaseConsumerEpoch = 0
		item.LeaseExpiresAt = nil
		if decision.Retryable && item.AttemptCount < decision.MaxAttempts {
			item.State = int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_RETRY_WAIT)
			item.NextAttemptAt = now.Add(retryDelay(
				item.AttemptCount,
				decision.BaseRetryDelay,
				decision.MaxRetryDelay,
			))
		} else {
			item.State = int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_DEAD_LETTER)
		}
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		rejected = item.toProto()
		return nil
	})
	if err != nil {
		return nil, err
	}

	return rejected, nil
}

func retryDelay(attempt uint32, base time.Duration, maximum time.Duration) time.Duration {
	delay := base
	for current := uint32(1); current < attempt; current++ {
		if delay >= maximum/2 {
			return maximum
		}
		delay *= 2
	}
	if delay > maximum {
		return maximum
	}

	return delay
}

func (r *QueueRepository) Stats(
	ctx context.Context,
	ptid string,
	deviceID string,
) (*messaging.QueueStats, error) {
	if ptid == "" || deviceID == "" {
		return nil, fmt.Errorf("messaging: queue stats require an endpoint")
	}

	var stats messaging.QueueStats
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lane, err := lockOrCreateLane(tx, ptid, deviceID)
		if err != nil {
			return err
		}
		stats.NextSequence = lane.NextSequence
		stats.AckedThrough = lane.AckedThrough

		type stateCount struct {
			State int32
			Count int64
		}
		var counts []stateCount
		if err := tx.Model(&DeviceQueueItemModel{}).
			Select("state, COUNT(*) AS count").
			Where("recipient_ptid = ? AND recipient_device_id = ?", ptid, deviceID).
			Group("state").
			Scan(&counts).Error; err != nil {
			return err
		}
		for _, count := range counts {
			switch chat.DeviceQueueItemState(count.State) {
			case chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_PENDING:
				stats.Pending = count.Count
			case chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_CLAIMED:
				stats.Claimed = count.Count
			case chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_RETRY_WAIT:
				stats.RetryWait = count.Count
			case chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_ACKED:
				stats.Acked = count.Count
			case chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_DEAD_LETTER:
				stats.DeadLetter = count.Count
			}
		}

		return tx.Model(&DeviceQueueItemModel{}).
			Select("COALESCE(SUM(LENGTH(opaque_payload)), 0)").
			Where(
				"recipient_ptid = ? AND recipient_device_id = ? AND state != ?",
				ptid,
				deviceID,
				int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_ACKED),
			).
			Scan(&stats.UnackedBytes).Error
	})
	if err != nil {
		return nil, err
	}

	return &stats, nil
}

func lockOrCreateLane(
	tx *gorm.DB,
	ptid string,
	deviceID string,
) (*DeviceQueueLaneModel, error) {
	lane := &DeviceQueueLaneModel{
		RecipientPTID:     ptid,
		RecipientDeviceID: deviceID,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(lane).Error; err != nil {
		return nil, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ?",
			ptid,
			deviceID,
		).
		First(lane).Error; err != nil {
		return nil, err
	}

	return lane, nil
}

func (r *QueueRepository) checkQuota(
	tx *gorm.DB,
	ptid string,
	deviceID string,
	incomingBytes int64,
) error {
	var usage struct {
		Items int64
		Bytes int64
	}
	if err := tx.Model(&DeviceQueueItemModel{}).
		Select("COUNT(*) AS items, COALESCE(SUM(LENGTH(opaque_payload)), 0) AS bytes").
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND state != ?",
			ptid,
			deviceID,
			int32(chat.DeviceQueueItemState_DEVICE_QUEUE_ITEM_STATE_ACKED),
		).
		Scan(&usage).Error; err != nil {
		return err
	}
	if usage.Items+1 > r.limits.MaxUnackedItems ||
		usage.Bytes+incomingBytes > r.limits.MaxUnackedBytes {
		return messaging.ErrQueueQuotaExceeded
	}

	return nil
}

func modelFromProto(item *chat.DeviceQueueItem) *DeviceQueueItemModel {
	model := &DeviceQueueItemModel{
		ItemID:            item.ItemId,
		RecipientPTID:     item.Recipient.Ptid,
		RecipientDeviceID: item.Recipient.DeviceId,
		LaneSequence:      item.LaneSequence,
		IdempotencyKey:    item.IdempotencyKey,
		EventID:           item.EventId,
		ConversationID:    item.ConversationId,
		PayloadType:       int32(item.PayloadType),
		OpaquePayload:     item.OpaquePayload,
		PayloadSHA256:     item.PayloadSha256,
		State:             int32(item.State),
		AttemptCount:      item.AttemptCount,
		LastErrorCode:     item.LastErrorCode,
	}
	if item.FirstQueuedAt != nil {
		model.FirstQueuedAt = item.FirstQueuedAt.AsTime()
	}
	if item.NextAttemptAt != nil {
		model.NextAttemptAt = item.NextAttemptAt.AsTime()
	}
	if item.ExpiresAt != nil {
		value := item.ExpiresAt.AsTime()
		model.ExpiresAt = &value
	}

	return model
}

func (model *DeviceQueueItemModel) toProto() *chat.DeviceQueueItem {
	item := &chat.DeviceQueueItem{
		ItemId: model.ItemID,
		Recipient: &chat.CryptoEndpoint{
			Ptid:     model.RecipientPTID,
			DeviceId: model.RecipientDeviceID,
		},
		LaneSequence:   model.LaneSequence,
		EventId:        model.EventID,
		ConversationId: model.ConversationID,
		IdempotencyKey: model.IdempotencyKey,
		PayloadType:    chat.DeviceQueuePayloadType(model.PayloadType),
		OpaquePayload:  model.OpaquePayload,
		PayloadSha256:  model.PayloadSHA256,
		State:          chat.DeviceQueueItemState(model.State),
		AttemptCount:   model.AttemptCount,
		FirstQueuedAt:  timestamppb.New(model.FirstQueuedAt),
		NextAttemptAt:  timestamppb.New(model.NextAttemptAt),
		LastErrorCode:  model.LastErrorCode,
	}
	if model.LeaseExpiresAt != nil {
		item.Lease = &chat.DeviceQueueLease{
			ConsumerId:    model.LeaseConsumerID,
			ConsumerEpoch: model.LeaseConsumerEpoch,
			ExpiresAt:     timestamppb.New(*model.LeaseExpiresAt),
		}
	}
	if model.ExpiresAt != nil {
		item.ExpiresAt = timestamppb.New(*model.ExpiresAt)
	}
	if model.ConsumedAt != nil {
		item.ConsumedAt = timestamppb.New(*model.ConsumedAt)
	}
	if model.AckedAt != nil {
		item.AckedAt = timestamppb.New(*model.AckedAt)
	}

	return item
}
