package infrastructure

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// OutboxModel is the GORM table model for cross-Station federation delivery.
type OutboxModel struct {
	ID                  uint      `gorm:"column:id;primaryKey"`
	OutboxItemID        string    `gorm:"column:outbox_item_id;size:64;uniqueIndex"`
	TargetStationPeerID string    `gorm:"column:target_station_peer_id;size:255;index"`
	IdempotencyKey      string    `gorm:"column:idempotency_key;size:255;uniqueIndex"`
	EnvelopeBytes       []byte    `gorm:"column:envelope_bytes;type:bytea"`
	Status              int32     `gorm:"column:status;index"`
	RetryCount          int32     `gorm:"column:retry_count"`
	LastError           string    `gorm:"column:last_error;type:text"`
	FirstQueuedAt       time.Time `gorm:"column:first_queued_at"`
	NextRetryAt         time.Time `gorm:"column:next_retry_at;index"`
	DeliveredAt         *time.Time `gorm:"column:delivered_at"`
}

func (*OutboxModel) TableName() string { return "envelope_outbox" }

// InboxModel is the GORM table model for per-device durable delivery.
type InboxModel struct {
	ID               uint      `gorm:"column:id;primaryKey"`
	InboxItemID      string    `gorm:"column:inbox_item_id;size:64;uniqueIndex"`
	RecipientDID     string    `gorm:"column:recipient_did;size:255;index:idx_inbox_device"`
	RecipientDeviceID string   `gorm:"column:recipient_device_id;size:255;index:idx_inbox_device"`
	IdempotencyKey   string    `gorm:"column:idempotency_key;size:255;index:idx_inbox_idemp,unique"`
	EnvelopeBytes    []byte    `gorm:"column:envelope_bytes;type:bytea"`
	Status           int32     `gorm:"column:status;index"`
	DeliveryAttempts int32     `gorm:"column:delivery_attempts"`
	FirstQueuedAt    time.Time `gorm:"column:first_queued_at"`
	LastAttemptAt    *time.Time `gorm:"column:last_attempt_at"`
	DeliveredAt      *time.Time `gorm:"column:delivered_at"`
}

func (*InboxModel) TableName() string { return "envelope_inbox" }

// IdempotencyModel tracks processed idempotency keys to prevent double-processing.
type IdempotencyModel struct {
	ID             uint      `gorm:"column:id;primaryKey"`
	IdempotencyKey string    `gorm:"column:idempotency_key;size:255;uniqueIndex"`
	CreatedAt      time.Time `gorm:"column:created_at"`
}

func (*IdempotencyModel) TableName() string { return "envelope_idempotency" }

// PostgresRepository implements envelope.Repository using GORM.
type PostgresRepository struct {
	db *gorm.DB
}

func NewPostgresRepository(db *gorm.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&OutboxModel{}, &InboxModel{}, &IdempotencyModel{})
}

// --- Outbox ---

func (r *PostgresRepository) EnqueueOutbox(ctx context.Context, item *chat.OutboxItem) (string, error) {
	envBytes, err := proto.Marshal(item.Envelope)
	if err != nil {
		return "", err
	}
	model := &OutboxModel{
		OutboxItemID:        item.OutboxItemId,
		TargetStationPeerID: item.TargetStationPeerId,
		IdempotencyKey:      item.Envelope.IdempotencyKey,
		EnvelopeBytes:       envBytes,
		Status:              int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_PENDING),
		RetryCount:          0,
		FirstQueuedAt:       time.Now(),
		NextRetryAt:         time.Now(),
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).
		Create(model)
	if result.Error != nil {
		return "", result.Error
	}
	r.recordIdempotency(ctx, item.Envelope.IdempotencyKey)
	return item.OutboxItemId, nil
}

func (r *PostgresRepository) PendingOutboxItems(ctx context.Context, limit int) ([]*chat.OutboxItem, error) {
	var models []OutboxModel
	now := time.Now()
	err := r.db.WithContext(ctx).
		Where("(status = ? AND next_retry_at <= ?) OR (status = ? AND next_retry_at <= ?)",
			int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_PENDING), now,
			int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_IN_FLIGHT), now,
		).
		Order("first_queued_at ASC").
		Limit(limit).
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	items := make([]*chat.OutboxItem, 0, len(models))
	for _, m := range models {
		item, err := m.toProto()
		if err != nil {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *PostgresRepository) MarkOutboxInFlight(ctx context.Context, outboxItemID string) error {
	return r.db.WithContext(ctx).
		Model(&OutboxModel{}).
		Where("outbox_item_id = ?", outboxItemID).
		Updates(map[string]any{
			"status":      int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_IN_FLIGHT),
			"retry_count": gorm.Expr("retry_count + 1"),
		}).Error
}

func (r *PostgresRepository) MarkOutboxDelivered(ctx context.Context, outboxItemID string, deliveredAt time.Time) error {
	return r.db.WithContext(ctx).
		Model(&OutboxModel{}).
		Where("outbox_item_id = ?", outboxItemID).
		Updates(map[string]any{
			"status":       int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_DELIVERED),
			"delivered_at": deliveredAt,
		}).Error
}

func (r *PostgresRepository) MarkOutboxDeadLetter(ctx context.Context, outboxItemID string, lastError string) error {
	return r.db.WithContext(ctx).
		Model(&OutboxModel{}).
		Where("outbox_item_id = ?", outboxItemID).
		Updates(map[string]any{
			"status":     int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_DEAD_LETTER),
			"last_error": lastError,
		}).Error
}

func (r *PostgresRepository) SetOutboxNextRetry(ctx context.Context, outboxItemID string, nextRetryAt time.Time, lastError string) error {
	return r.db.WithContext(ctx).
		Model(&OutboxModel{}).
		Where("outbox_item_id = ?", outboxItemID).
		Updates(map[string]any{
			"status":        int32(chat.OutboxItemStatus_OUTBOX_ITEM_STATUS_PENDING),
			"next_retry_at": nextRetryAt,
			"last_error":    lastError,
		}).Error
}

// --- Inbox ---

func (r *PostgresRepository) EnqueueInbox(ctx context.Context, item *chat.DeviceInboxItem) (string, error) {
	envBytes, err := proto.Marshal(item.Envelope)
	if err != nil {
		return "", err
	}
	model := &InboxModel{
		InboxItemID:       item.InboxItemId,
		RecipientDID:      item.RecipientActorDid,
		RecipientDeviceID: item.RecipientDeviceId,
		IdempotencyKey:    item.Envelope.IdempotencyKey,
		EnvelopeBytes:     envBytes,
		Status:            int32(chat.InboxItemStatus_INBOX_ITEM_STATUS_PENDING),
		DeliveryAttempts:  0,
		FirstQueuedAt:     time.Now(),
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).
		Create(model)
	if result.Error != nil {
		return "", result.Error
	}
	r.recordIdempotency(ctx, item.Envelope.IdempotencyKey)
	return item.InboxItemId, nil
}

func (r *PostgresRepository) MarkInboxDelivered(ctx context.Context, inboxItemID string, deliveredAt time.Time) error {
	return r.db.WithContext(ctx).
		Model(&InboxModel{}).
		Where("inbox_item_id = ?", inboxItemID).
		Updates(map[string]any{
			"status":       int32(chat.InboxItemStatus_INBOX_ITEM_STATUS_DELIVERED),
			"delivered_at": deliveredAt,
		}).Error
}

func (r *PostgresRepository) MarkInboxAcked(ctx context.Context, inboxItemID string) error {
	return r.db.WithContext(ctx).
		Model(&InboxModel{}).
		Where("inbox_item_id = ?", inboxItemID).
		Update("status", int32(chat.InboxItemStatus_INBOX_ITEM_STATUS_ACKED)).Error
}

func (r *PostgresRepository) UnackedInboxItems(ctx context.Context, recipientDID, deviceID string, afterCursor string, limit int) ([]*chat.DeviceInboxItem, error) {
	var models []InboxModel
	q := r.db.WithContext(ctx).
		Where("recipient_did = ? AND (recipient_device_id = ? OR recipient_device_id = '') AND status != ?",
			recipientDID, deviceID, int32(chat.InboxItemStatus_INBOX_ITEM_STATUS_ACKED),
		)
	if afterCursor != "" {
		q = q.Where("inbox_item_id > ?", afterCursor)
	}
	err := q.Order("first_queued_at ASC").Limit(limit).Find(&models).Error
	if err != nil {
		return nil, err
	}
	items := make([]*chat.DeviceInboxItem, 0, len(models))
	for _, m := range models {
		item, err := m.toProto()
		if err != nil {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

// --- Idempotency ---

func (r *PostgresRepository) HasIdempotencyKey(ctx context.Context, idempotencyKey string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&IdempotencyModel{}).
		Where("idempotency_key = ?", idempotencyKey).
		Count(&count).Error
	return count > 0, err
}

func (r *PostgresRepository) recordIdempotency(ctx context.Context, key string) {
	r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&IdempotencyModel{IdempotencyKey: key, CreatedAt: time.Now()})
}

// --- Helpers ---

func (m *OutboxModel) toProto() (*chat.OutboxItem, error) {
	env := &chat.StationEnvelope{}
	if err := proto.Unmarshal(m.EnvelopeBytes, env); err != nil {
		return nil, err
	}
	return &chat.OutboxItem{
		OutboxItemId:        m.OutboxItemID,
		TargetStationPeerId: m.TargetStationPeerID,
		Envelope:            env,
		Status:              chat.OutboxItemStatus(m.Status),
		RetryCount:          m.RetryCount,
	}, nil
}

func (m *InboxModel) toProto() (*chat.DeviceInboxItem, error) {
	env := &chat.StationEnvelope{}
	if err := proto.Unmarshal(m.EnvelopeBytes, env); err != nil {
		return nil, err
	}
	return &chat.DeviceInboxItem{
		InboxItemId:       m.InboxItemID,
		RecipientActorDid: m.RecipientDID,
		RecipientDeviceId: m.RecipientDeviceID,
		Envelope:          env,
		Status:            chat.InboxItemStatus(m.Status),
		DeliveryAttempts:  m.DeliveryAttempts,
	}, nil
}
