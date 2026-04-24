package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type ConversationType string

type Conversation struct {
	ID        uint64           `gorm:"column:id;primary_key;autoIncrement:false"`
	ConvID    string           `gorm:"column:conv_id;uniqueIndex;size:64;not null"`
	Type      ConversationType `gorm:"column:type;size:16;index"`
	Title     string           `gorm:"column:title;size:255"`
	AvatarCID string           `gorm:"column:avatar_cid;size:128"`
	Policy    string           `gorm:"column:policy;size:255"`
	Epoch     int              `gorm:"column:epoch;index"`
	CreatedAt time.Time        `gorm:"column:created_at"`
	UpdatedAt time.Time        `gorm:"column:updated_at"`
}

func (*Conversation) TableName() string { return "touch_conversation" }

func (c *Conversation) BeforeCreate(tx *gorm.DB) error {
	if c.ID == 0 {
		c.ID = id.NextID()
	}
	return nil
}
