package db

import (
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/util/id"
    "gorm.io/gorm"
)

type Role string

type ConvMember struct {
    ID        uint64    `gorm:"primary_key;autoIncrement:false"`
    ConvID    uint64    `gorm:"index;not null"`
    DID       string    `gorm:"size:128;not null"`
    Role      Role      `gorm:"size:16"`
    JoinedAt  time.Time `gorm:"index"`
    CreatedAt time.Time `gorm:"created_at"`
    UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ConvMember) TableName() string { return "touch_conv_member" }

func (m *ConvMember) BeforeCreate(tx *gorm.DB) error {
    if m.ID == 0 { m.ID = id.NextID() }
    return nil
}