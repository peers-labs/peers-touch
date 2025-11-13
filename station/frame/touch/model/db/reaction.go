package db

import (
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/util/id"
    "gorm.io/gorm"
)

type Reaction struct {
    ID        uint64    `gorm:"primary_key;autoIncrement:false"`
    MsgULID   string    `gorm:"index;size:32;not null"`
    MemberDID string    `gorm:"index;size:128;not null"`
    Emoji     string    `gorm:"size:16;not null"`
    Op        string    `gorm:"size:8"`
    TS        int64     `gorm:"index"`
    CreatedAt time.Time `gorm:"created_at"`
    UpdatedAt time.Time `gorm:"updated_at"`
}

func (*Reaction) TableName() string { return "touch_reaction" }

func (r *Reaction) BeforeCreate(tx *gorm.DB) error {
    if r.ID == 0 { r.ID = id.NextID() }
    return nil
}