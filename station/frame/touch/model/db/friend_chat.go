package db

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type FriendChatSession struct {
	ID              uint64    `gorm:"primary_key;autoIncrement:false"`
	ULID            string    `gorm:"uniqueIndex;size:26;not null"`
	ParticipantADID string    `gorm:"size:255;not null;index:idx_fcs_participants"`
	ParticipantBDID string    `gorm:"size:255;not null;index:idx_fcs_participants"`
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

type FriendChatMessage struct {
	ID          uint64     `gorm:"primary_key;autoIncrement:false"`
	ULID        string     `gorm:"uniqueIndex;size:26;not null"`
	SessionULID string     `gorm:"size:26;not null;index:idx_fcm_session"`
	SenderDID   string     `gorm:"size:255;not null;index:idx_fcm_sender"`
	ReceiverDID string     `gorm:"size:255;not null;index:idx_fcm_receiver"`
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

type OfflineMessage struct {
	ID               uint64    `gorm:"primary_key;autoIncrement:false"`
	ULID             string    `gorm:"uniqueIndex;size:26;not null"`
	ReceiverDID      string    `gorm:"size:255;not null;index:idx_om_receiver_status"`
	SenderDID        string    `gorm:"size:255;not null"`
	SessionULID      string    `gorm:"size:26;not null"`
	EncryptedPayload []byte    `gorm:"type:bytea;not null"`
	Status           int32     `gorm:"default:1;not null;index:idx_om_receiver_status"`
	ExpireAt         time.Time `gorm:"not null;index:idx_om_expire"`
	DeliveredAt      *time.Time
	CreatedAt        time.Time `gorm:"not null;default:now()"`
	UpdatedAt        time.Time `gorm:"not null;default:now()"`
}

func (*OfflineMessage) TableName() string {
	return "touch_offline_message"
}

func (m *OfflineMessage) BeforeCreate(tx *gorm.DB) error {
	if m.ID == 0 {
		m.ID = id.NextID()
	}
	return nil
}

func init() {
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		err := rds.AutoMigrate(
			&FriendChatSession{},
			&FriendChatMessage{},
			&FriendMessageAttachment{},
			&OfflineMessage{},
		)
		if err != nil {
			panic(fmt.Errorf("friend chat auto migrate failed: %v", err))
		}
	})
}
