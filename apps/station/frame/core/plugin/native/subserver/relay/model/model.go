package model

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type MountStatus int32

const (
	MountStatusOnline  MountStatus = 1
	MountStatusOffline MountStatus = 2
)

type InviteStatus int32

const (
	InviteStatusActive   InviteStatus = 1
	InviteStatusConsumed InviteStatus = 2
	InviteStatusExpired  InviteStatus = 3
	InviteStatusRevoked  InviteStatus = 4
)

type RelayMount struct {
	ID             uint64      `gorm:"primaryKey;autoIncrement:false"`
	StationPeerID  string      `gorm:"size:255;uniqueIndex"`
	Label          string      `gorm:"size:255"`
	Status         MountStatus `gorm:"index"`
	MaxClients     int32
	BandwidthLimit int64
	InviteID       uint64    `gorm:"index"`
	LastHeartbeat  time.Time `gorm:"index"`
	MountedAt      time.Time
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime"`
}

func (*RelayMount) TableName() string {
	return "relay_mount"
}

func (r *RelayMount) BeforeCreate(tx *gorm.DB) error {
	if r.ID == 0 {
		r.ID = id.NextID()
	}
	return nil
}

type RelayInvite struct {
	ID             uint64 `gorm:"primaryKey;autoIncrement:false"`
	Token          string `gorm:"size:512;uniqueIndex"`
	StationPeerID  string `gorm:"size:255;index"`
	Label          string `gorm:"size:255"`
	MaxClients     int32
	BandwidthLimit int64
	Status         InviteStatus `gorm:"index"`
	ConsumedBy     string       `gorm:"size:255"`
	ConsumedAt     *time.Time
	ExpiresAt      time.Time `gorm:"index"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime"`
}

func (*RelayInvite) TableName() string {
	return "relay_invite"
}

func (r *RelayInvite) BeforeCreate(tx *gorm.DB) error {
	if r.ID == 0 {
		r.ID = id.NextID()
	}
	return nil
}
