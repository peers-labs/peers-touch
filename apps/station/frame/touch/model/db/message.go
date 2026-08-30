package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type MessageType string

type Message struct {
	ID         uint64      `gorm:"column:id;primary_key;autoIncrement:false"`
	ULID       string      `gorm:"column:ulid;uniqueIndex;size:32;not null"`
	ConvPK     uint64      `gorm:"column:conv_pk;index;not null"`
	ConvID     string      `gorm:"column:conv_id;index;size:64;not null"`
	SenderPtid string      `gorm:"column:sender_ptid;size:128;index"`
	TS         int64       `gorm:"column:ts;index"`
	Type       MessageType `gorm:"column:type;size:16;index"`
	ParentID   string      `gorm:"column:parent_id;size:32"`
	ThreadID   string      `gorm:"column:thread_id;size:32"`
	ContentCID string      `gorm:"column:content_cid;size:128"`
	Deleted    bool        `gorm:"column:deleted;index"`
	TTLAt      time.Time   `gorm:"column:ttl_at;index"`
	CreatedAt  time.Time   `gorm:"column:created_at"`
	UpdatedAt  time.Time   `gorm:"column:updated_at"`
}

func (*Message) TableName() string { return "touch_message" }

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}
