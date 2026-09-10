package delivery

import "time"

// OutboxState is the durable lifecycle of one immutable delivery frame.
type OutboxState string

const (
	OutboxStatePending   OutboxState = "pending"
	OutboxStateLeased    OutboxState = "leased"
	OutboxStateRetryWait OutboxState = "retry_wait"
	OutboxStateDelivered OutboxState = "delivered"
	OutboxStateTerminal  OutboxState = "terminal"
	OutboxStateExpired   OutboxState = "expired"
)

// InboxRecord is the explicit durable deduplication receipt.
type InboxRecord struct {
	SourceStationPeerID string         `gorm:"column:source_station_peer_id;size:512;primaryKey"`
	IdempotencyKey      string         `gorm:"column:idempotency_key;size:512;primaryKey"`
	FrameID             string         `gorm:"column:frame_id;size:512;not null;uniqueIndex:uidx_fdi_frame"`
	PayloadKind         int32          `gorm:"column:payload_kind;not null"`
	PayloadID           string         `gorm:"column:payload_id;size:512;not null"`
	PayloadSHA256       []byte         `gorm:"column:payload_sha256;type:bytea;not null"`
	CanonicalSHA256     []byte         `gorm:"column:canonical_sha256;type:bytea;not null"`
	Disposition         Disposition    `gorm:"column:disposition;not null"`
	ErrorCode           FrameErrorCode `gorm:"column:error_code;not null"`
	ReceivedAt          time.Time      `gorm:"column:received_at;not null"`
	CompletedAt         time.Time      `gorm:"column:completed_at;not null"`
}

// TableName pins the inbox schema contract independently of GORM naming rules.
func (*InboxRecord) TableName() string {
	return "federation_delivery_inbox"
}

// OutboxRecord is the explicit durable retry and lease record.
type OutboxRecord struct {
	FrameID             string      `gorm:"column:frame_id;size:512;primaryKey"`
	SourceStationPeerID string      `gorm:"column:source_station_peer_id;size:512;not null;uniqueIndex:uidx_fdo_source_idempotency,priority:1;uniqueIndex:uidx_fdo_ordered_lane,priority:1,where:ordering_sequence > 0"`
	TargetStationPeerID string      `gorm:"column:target_station_peer_id;size:512;not null;index:idx_fdo_ready,priority:3;index:idx_fdo_lane,priority:1;uniqueIndex:uidx_fdo_ordered_lane,priority:2,where:ordering_sequence > 0"`
	IdempotencyKey      string      `gorm:"column:idempotency_key;size:512;not null;uniqueIndex:uidx_fdo_source_idempotency,priority:2"`
	PayloadKind         int32       `gorm:"column:payload_kind;not null"`
	PayloadID           string      `gorm:"column:payload_id;size:512;not null"`
	OrderingKey         string      `gorm:"column:ordering_key;size:512;not null;index:idx_fdo_lane,priority:2;uniqueIndex:uidx_fdo_ordered_lane,priority:3,where:ordering_sequence > 0"`
	OrderingSequence    int64       `gorm:"column:ordering_sequence;not null;index:idx_fdo_lane,priority:3;uniqueIndex:uidx_fdo_ordered_lane,priority:4,where:ordering_sequence > 0"`
	FrameBytes          []byte      `gorm:"column:frame_bytes;type:bytea;not null"`
	PayloadSHA256       []byte      `gorm:"column:payload_sha256;type:bytea;not null"`
	CanonicalSHA256     []byte      `gorm:"column:canonical_sha256;type:bytea;not null"`
	State               OutboxState `gorm:"column:state;size:32;not null;index:idx_fdo_ready,priority:1"`
	AttemptCount        uint32      `gorm:"column:attempt_count;not null"`
	NextAttemptAt       time.Time   `gorm:"column:next_attempt_at;not null;index:idx_fdo_ready,priority:2"`
	LeaseOwner          string      `gorm:"column:lease_owner;size:512;not null;default:''"`
	LeaseGeneration     uint64      `gorm:"column:lease_generation;not null"`
	LeaseExpiresAt      *time.Time  `gorm:"column:lease_expires_at;index"`
	ExpiresAt           time.Time   `gorm:"column:expires_at;not null;index"`
	CreatedAt           time.Time   `gorm:"column:created_at;not null"`
	DeliveredAt         *time.Time  `gorm:"column:delivered_at"`
	TerminalAt          *time.Time  `gorm:"column:terminal_at"`
	LastFailure         FailureCode `gorm:"column:last_failure;size:64;not null;default:''"`
}

// TableName pins the outbox schema contract independently of GORM naming rules.
func (*OutboxRecord) TableName() string {
	return "federation_delivery_outbox"
}
