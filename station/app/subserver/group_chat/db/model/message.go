package model

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// Message type constants
const (
	MessageTypeText   = 1
	MessageTypeImage  = 2
	MessageTypeFile   = 3
	MessageTypeAudio  = 4
	MessageTypeVideo  = 5
	MessageTypeSystem = 10
)

// StringSlice is a custom type for storing string slices in database
type StringSlice []string

func (s StringSlice) Value() (driver.Value, error) {
	if s == nil {
		return "[]", nil
	}
	return json.Marshal(s)
}

func (s *StringSlice) Scan(value interface{}) error {
	if value == nil {
		*s = []string{}
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		str, ok := value.(string)
		if !ok {
			*s = []string{}
			return nil
		}
		bytes = []byte(str)
	}
	return json.Unmarshal(bytes, s)
}

// GroupMessage represents a message in a group
type GroupMessage struct {
	ID            uint64      `gorm:"primaryKey;autoIncrement"`
	ULID          string      `gorm:"column:ul_id;uniqueIndex;size:26;not null"`
	GroupULID     string      `gorm:"column:group_ul_id;size:26;not null;index:idx_group_messages"`
	SenderDID     string      `gorm:"column:sender_did;size:50;not null;index"`
	Type          int         `gorm:"default:1"`
	Content       string      `gorm:"type:text;not null"`
	ReplyToULID   string      `gorm:"column:reply_to_ul_id;size:26"`
	MentionedDIDs StringSlice `gorm:"column:mentioned_dids;type:text"`
	MentionAll    bool        `gorm:"default:false"`
	Deleted       bool        `gorm:"default:false"`
	SentAt        time.Time   `gorm:"index:idx_group_messages"`
	CreatedAt     time.Time   `gorm:"autoCreateTime"`
	UpdatedAt     time.Time   `gorm:"autoUpdateTime"`
}

func (GroupMessage) TableName() string {
	return "touch_group_message"
}

// GroupOfflineMessage tracks undelivered messages for offline members
type GroupOfflineMessage struct {
	ID          uint64    `gorm:"primaryKey;autoIncrement"`
	ULID        string    `gorm:"column:ul_id;uniqueIndex;size:26;not null"`
	GroupULID   string    `gorm:"column:group_ul_id;size:26;not null;index"`
	ReceiverDID string    `gorm:"column:receiver_did;size:50;not null;index:idx_offline_receiver"`
	MessageULID string    `gorm:"column:message_ul_id;size:26;not null"`
	Status      int       `gorm:"default:1"` // 1=pending, 2=delivered, 3=expired
	ExpireAt    time.Time `gorm:"index"`
	DeliveredAt time.Time
	CreatedAt   time.Time `gorm:"autoCreateTime"`
}

func (GroupOfflineMessage) TableName() string {
	return "touch_group_offline_message"
}

// Offline message status constants
const (
	OfflineStatusPending   = 1
	OfflineStatusDelivered = 2
	OfflineStatusExpired   = 3
)
