package db

import (
	"time"
)

const (
	ActorStatusOffline = 0
	ActorStatusOnline  = 1
	ActorStatusAway    = 2
)

type ActorStatus struct {
	ActorID       uint64    `gorm:"column:actor_id;primary_key;autoIncrement:false"`
	Status        int       `gorm:"column:status;default:0"` // 0: Offline, 1: Online, 2: Away
	LastHeartbeat time.Time `gorm:"column:last_heartbeat;index"`
	ClientInfo    string    `gorm:"column:client_info;size:255"`
	UpdatedAt     time.Time `gorm:"column:updated_at"`
}

func (*ActorStatus) TableName() string {
	return "touch_actor_status"
}
