package model

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type FriendChatMessage struct {
	ID          uint64     `gorm:"primary_key;autoIncrement:false"`
	ULID        string     `gorm:"uniqueIndex;size:26;not null"`
	SessionULID string     `gorm:"size:26;not null;index:idx_fcm_session"`
	SenderDID   string     `gorm:"column:sender_did;size:255;not null;index:idx_fcm_sender"`
	ReceiverDID string     `gorm:"column:receiver_did;size:255;not null;index:idx_fcm_receiver"`
	Type        int32      `gorm:"default:1;not null"`
	Content     string     `gorm:"type:text"`
	ReplyToULID string     `gorm:"size:26"`
	Status      int32      `gorm:"default:1;not null"`
	SentAt      time.Time  `gorm:"not null;default:now()"`
	DeliveredAt *time.Time `gorm:""`
	ReadAt      *time.Time `gorm:""`
	CreatedAt   time.Time  `gorm:"not null;default:now()"`
	UpdatedAt   time.Time  `gorm:"not null;default:now()"`
}

func (*FriendChatMessage) TableName() string {
	return "touch_friend_chat_message"
}

func (m *FriendChatMessage) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}
