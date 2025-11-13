package db

import (
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/util/id"
    "gorm.io/gorm"
)

type KeyEpoch struct {
    ID        uint64    `gorm:"primary_key;autoIncrement:false"`
    ConvID    uint64    `gorm:"index;not null"`
    Epoch     int       `gorm:"index"`
    KeyMetaCID string   `gorm:"size:128"`
    CreatedAt time.Time `gorm:"created_at"`
    UpdatedAt time.Time `gorm:"updated_at"`
}

func (*KeyEpoch) TableName() string { return "touch_key_epoch" }

func (k *KeyEpoch) BeforeCreate(tx *gorm.DB) error {
    if k.ID == 0 { k.ID = id.NextID() }
    return nil
}