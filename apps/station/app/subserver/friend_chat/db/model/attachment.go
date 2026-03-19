package model

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type FriendMessageAttachment struct {
	ID           uint64    `gorm:"primary_key;autoIncrement:false"`
	MessageULID  string    `gorm:"size:26;not null;index:idx_fma_message"`
	CID          string    `gorm:"size:255;not null"`
	Filename     string    `gorm:"size:255;not null"`
	MimeType     string    `gorm:"size:100;not null"`
	Size         int64     `gorm:"not null"`
	ThumbnailCID string    `gorm:"size:255"`
	CreatedAt    time.Time `gorm:"not null;default:now()"`
}

func (*FriendMessageAttachment) TableName() string {
	return "touch_friend_message_attachment"
}

func (a *FriendMessageAttachment) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}
