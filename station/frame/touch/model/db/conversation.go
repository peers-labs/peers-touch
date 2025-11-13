package db

import (
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/util/id"
    "gorm.io/gorm"
)

type ConversationType string

type Conversation struct {
    ID        uint64           `gorm:"primary_key;autoIncrement:false"`
    ConvID    string           `gorm:"uniqueIndex;size:64;not null"`
    Type      ConversationType `gorm:"size:16;index"`
    Title     string           `gorm:"size:255"`
    AvatarCID string           `gorm:"size:128"`
    Policy    string           `gorm:"size:255"`
    Epoch     int              `gorm:"index"`
    CreatedAt time.Time        `gorm:"created_at"`
    UpdatedAt time.Time        `gorm:"updated_at"`
}

func (*Conversation) TableName() string { return "touch_conversation" }

func (c *Conversation) BeforeCreate(tx *gorm.DB) error {
    if c.ID == 0 { c.ID = id.NextID() }
    return nil
}