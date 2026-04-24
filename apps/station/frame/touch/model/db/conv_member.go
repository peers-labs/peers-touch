package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type Role string

type ConvMember struct {
	ID        uint64    `gorm:"column:id;primary_key;autoIncrement:false"`
	ConvID    uint64    `gorm:"column:conv_id;index;not null"`
	DID       string    `gorm:"column:did;size:128;not null"`
	Role      Role      `gorm:"column:role;size:16"`
	JoinedAt  time.Time `gorm:"column:joined_at;index"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*ConvMember) TableName() string { return "touch_conv_member" }

func (m *ConvMember) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}
