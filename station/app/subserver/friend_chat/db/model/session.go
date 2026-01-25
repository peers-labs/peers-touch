package model

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type FriendChatSession struct {
	ID              uint64    `gorm:"primary_key;autoIncrement:false"`
	ULID            string    `gorm:"uniqueIndex;size:26;not null"`
	ParticipantADID string    `gorm:"column:participant_a_did;size:255;not null;index:idx_fcs_participants"`
	ParticipantBDID string    `gorm:"column:participant_b_did;size:255;not null;index:idx_fcs_participants"`
	LastMessageULID string    `gorm:"size:26"`
	LastMessageAt   time.Time `gorm:"index:idx_fcs_last_message_at"`
	UnreadCountA    int32     `gorm:"default:0"`
	UnreadCountB    int32     `gorm:"default:0"`
	CreatedAt       time.Time `gorm:"not null;default:now()"`
	UpdatedAt       time.Time `gorm:"not null;default:now()"`
}

func (*FriendChatSession) TableName() string {
	return "touch_friend_chat_session"
}

func (s *FriendChatSession) BeforeCreate(tx *gorm.DB) error {
	if s.ID == 0 {
		s.ID = id.NextID()
	}
	return nil
}
