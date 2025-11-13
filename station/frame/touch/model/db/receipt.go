package db

import (
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/util/id"
    "gorm.io/gorm"
)

type Receipt struct {
    ID          uint64    `gorm:"primary_key;autoIncrement:false"`
    MsgULID     string    `gorm:"index;size:32;not null"`
    MemberDID   string    `gorm:"index;size:128;not null"`
    DeliveredAt time.Time `gorm:"index"`
    ReadAt      time.Time `gorm:"index"`
    FailReason  string    `gorm:"size:128"`
    CreatedAt   time.Time `gorm:"created_at"`
    UpdatedAt   time.Time `gorm:"updated_at"`
}

func (*Receipt) TableName() string { return "touch_receipt" }

func (r *Receipt) BeforeCreate(tx *gorm.DB) error {
    if r.ID == 0 { r.ID = id.NextID() }
    return nil
}