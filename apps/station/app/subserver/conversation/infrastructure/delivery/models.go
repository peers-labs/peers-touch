package delivery

import "time"

// DeviceQueueLaneModel maps the canonical per-device lane table.
type DeviceQueueLaneModel struct {
	RecipientPTID       string `gorm:"column:recipient_ptid;size:255;primaryKey"`
	RecipientDeviceID   string `gorm:"column:recipient_device_id;size:255;primaryKey"`
	NextSequence        int64  `gorm:"column:next_sequence;not null"`
	AckedThrough        int64  `gorm:"column:acked_through;not null"`
	ActiveConsumerID    string `gorm:"column:active_consumer_id;size:255"`
	ActiveConsumerEpoch uint64 `gorm:"column:active_consumer_epoch;not null"`
}

// TableName binds DeviceQueueLaneModel to the existing canonical lane store.
func (*DeviceQueueLaneModel) TableName() string {
	return "device_queue_lanes"
}

// DeviceQueueItemModel maps the canonical durable device-inbox item table.
type DeviceQueueItemModel struct {
	ID                      uint       `gorm:"column:id;primaryKey"`
	ItemID                  string     `gorm:"column:item_id;size:64;uniqueIndex"`
	RecipientPTID           string     `gorm:"column:recipient_ptid;size:255;uniqueIndex:idx_device_queue_sequence;uniqueIndex:idx_device_queue_idempotency"`
	RecipientDeviceID       string     `gorm:"column:recipient_device_id;size:255;uniqueIndex:idx_device_queue_sequence;uniqueIndex:idx_device_queue_idempotency"`
	LaneSequence            int64      `gorm:"column:lane_sequence;uniqueIndex:idx_device_queue_sequence"`
	IdempotencyKey          string     `gorm:"column:idempotency_key;size:255;uniqueIndex:idx_device_queue_idempotency"`
	EventID                 string     `gorm:"column:event_id;size:64;index"`
	EventSequence           uint64     `gorm:"column:event_sequence;not null"`
	ConversationID          string     `gorm:"column:conversation_id;size:64;index"`
	PayloadType             int32      `gorm:"column:payload_type"`
	OpaquePayload           []byte     `gorm:"column:opaque_payload;type:bytea"`
	PayloadSHA256           []byte     `gorm:"column:payload_sha256;type:bytea"`
	State                   int32      `gorm:"column:state;index"`
	AttemptCount            uint32     `gorm:"column:attempt_count"`
	LeaseConsumerID         string     `gorm:"column:lease_consumer_id;size:255"`
	LeaseConsumerEpoch      uint64     `gorm:"column:lease_consumer_epoch"`
	LeaseExpiresAt          *time.Time `gorm:"column:lease_expires_at;index"`
	FirstQueuedAt           time.Time  `gorm:"column:first_queued_at"`
	NextAttemptAt           time.Time  `gorm:"column:next_attempt_at;index"`
	ExpiresAt               *time.Time `gorm:"column:expires_at"`
	ConsumedAt              *time.Time `gorm:"column:consumed_at"`
	AckedAt                 *time.Time `gorm:"column:acked_at"`
	ConsumptionReceiptID    *string    `gorm:"column:consumption_receipt_id;size:255;uniqueIndex"`
	LastErrorCode           string     `gorm:"column:last_error_code;size:128"`
	LastRejectConsumerEpoch uint64     `gorm:"column:last_reject_consumer_epoch"`
}

// TableName binds DeviceQueueItemModel to the existing canonical item store.
func (*DeviceQueueItemModel) TableName() string {
	return "device_queue_items"
}
