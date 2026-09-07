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

// AuthorityDeliveryCommitmentModel is the authority-owned immutable mapping
// from an event commitment to its exact endpoint delivery.
type AuthorityDeliveryCommitmentModel struct {
	EventID               string    `gorm:"column:event_id;size:128;primaryKey;uniqueIndex:uidx_conversation_delivery_commitment,priority:1"`
	RecipientPTID         string    `gorm:"column:recipient_ptid;size:255;primaryKey"`
	RecipientDeviceID     string    `gorm:"column:recipient_device_id;size:255;primaryKey"`
	ConversationID        string    `gorm:"column:conversation_id;size:128;not null;index"`
	EventSequence         uint64    `gorm:"column:event_sequence;not null"`
	OriginatorPTID        string    `gorm:"column:originator_ptid;size:255;not null"`
	HomeStation           string    `gorm:"column:home_station_peer_id;size:255;not null"`
	PayloadKind           string    `gorm:"column:payload_kind;size:32;not null"`
	EndpointPayloadSHA256 []byte    `gorm:"column:endpoint_payload_sha256;type:bytea;not null"`
	CommitmentSHA256      []byte    `gorm:"column:delivery_commitment_sha256;type:bytea;not null;uniqueIndex:uidx_conversation_delivery_commitment,priority:2"`
	QueueItemID           string    `gorm:"column:queue_item_id;size:64;not null;uniqueIndex"`
	QueuePayloadSHA256    []byte    `gorm:"column:queue_payload_sha256;type:bytea;not null"`
	RequiredRecipient     bool      `gorm:"column:required_recipient;not null;index"`
	CreatedAt             time.Time `gorm:"column:created_at;not null"`
}

// TableName binds the endpoint commitment ledger to the Conversation authority.
func (*AuthorityDeliveryCommitmentModel) TableName() string {
	return "conversation_delivery_commitments"
}

// AuthorityDeliveryReceiptModel records one exact consumed receipt per
// committed endpoint delivery at the Conversation authority.
type AuthorityDeliveryReceiptModel struct {
	ReceiptID          string    `gorm:"column:receipt_id;size:255;primaryKey"`
	EventID            string    `gorm:"column:event_id;size:128;not null;uniqueIndex:uidx_conversation_delivery_receipt_endpoint,priority:1;index"`
	RecipientPTID      string    `gorm:"column:recipient_ptid;size:255;not null;uniqueIndex:uidx_conversation_delivery_receipt_endpoint,priority:2"`
	RecipientDeviceID  string    `gorm:"column:recipient_device_id;size:255;not null;uniqueIndex:uidx_conversation_delivery_receipt_endpoint,priority:3"`
	SourceHomeStation  string    `gorm:"column:source_home_station_peer_id;size:255;not null"`
	ConversationID     string    `gorm:"column:conversation_id;size:128;not null;index"`
	EventSequence      uint64    `gorm:"column:event_sequence;not null"`
	LaneSequence       int64     `gorm:"column:lane_sequence;not null"`
	QueuePayloadSHA256 []byte    `gorm:"column:queue_payload_sha256;type:bytea;not null"`
	CommitmentSHA256   []byte    `gorm:"column:delivery_commitment_sha256;type:bytea;not null"`
	ConsumedAt         time.Time `gorm:"column:consumed_at;not null"`
}

// TableName binds exact endpoint receipts to the Conversation authority.
func (*AuthorityDeliveryReceiptModel) TableName() string {
	return "conversation_delivery_receipts"
}
