package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type Reaction struct {
	ID        uint64    `gorm:"column:id;primary_key;autoIncrement:false"`
	MsgULID   string    `gorm:"column:msg_ulid;index;size:32;not null"`
	MemberDID string    `gorm:"column:member_did;index;size:128;not null"`
	Emoji     string    `gorm:"column:emoji;size:16;not null"`
	Op        string    `gorm:"column:op;size:8"`
	TS        int64     `gorm:"column:ts;index"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*Reaction) TableName() string { return "touch_reaction" }

func (r *Reaction) BeforeCreate(tx *gorm.DB) error {
	if r.ID == 0 {
		r.ID = id.NextID()
	}
	return nil
}
