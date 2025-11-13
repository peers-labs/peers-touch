package db

import (
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/util/id"
    "gorm.io/gorm"
)

type MessageType string

type Message struct {
    ID          uint64      `gorm:"primary_key;autoIncrement:false"`
    ULID        string      `gorm:"uniqueIndex;size:32;not null"`
    ConvPK      uint64      `gorm:"index;not null"`
    ConvID      string      `gorm:"index;size:64;not null"`
    SenderDID   string      `gorm:"size:128;index"`
    TS          int64       `gorm:"index"`
    Type        MessageType `gorm:"size:16;index"`
    ParentID    string      `gorm:"size:32"`
    ThreadID    string      `gorm:"size:32"`
    ContentCID  string      `gorm:"size:128"`
    Deleted     bool        `gorm:"index"`
    TTLAt       time.Time   `gorm:"index"`
    CreatedAt   time.Time   `gorm:"created_at"`
    UpdatedAt   time.Time   `gorm:"updated_at"`
}

func (*Message) TableName() string { return "touch_message" }

func (m *Message) BeforeCreate(tx *gorm.DB) error {
    if m.ID == 0 { m.ID = id.NextID() }
    return nil
}