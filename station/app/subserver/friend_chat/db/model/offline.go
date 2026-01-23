package model

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

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
