package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type KeyEpoch struct {
	ID         uint64    `gorm:"column:id;primary_key;autoIncrement:false"`
	ConvID     uint64    `gorm:"column:conv_id;index;not null"`
	Epoch      int       `gorm:"column:epoch;index"`
	KeyMetaCID string    `gorm:"column:key_meta_cid;size:128"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

func (*KeyEpoch) TableName() string { return "touch_key_epoch" }

func (k *KeyEpoch) BeforeCreate(tx *gorm.DB) error {
	if k.ID == 0 {
		k.ID = id.NextID()
	}
	return nil
}
