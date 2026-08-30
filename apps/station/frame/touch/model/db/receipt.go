package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type Receipt struct {
	ID          uint64    `gorm:"column:id;primary_key;autoIncrement:false"`
	MsgULID     string    `gorm:"column:msg_ulid;index;size:32;not null"`
	MemberPTID  string    `gorm:"column:member_ptid;index;size:128;not null"`
	DeliveredAt time.Time `gorm:"column:delivered_at;index"`
	ReadAt      time.Time `gorm:"column:read_at;index"`
	FailReason  string    `gorm:"column:fail_reason;size:128"`
	CreatedAt   time.Time `gorm:"column:created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at"`
}

func (*Receipt) TableName() string { return "touch_receipt" }

func (r *Receipt) BeforeCreate(tx *gorm.DB) error {
	if r.ID == 0 {
		r.ID = id.NextID()
	}
	return nil
}
