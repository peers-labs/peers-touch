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
    ActorID       uint64    `gorm:"primary_key;autoIncrement:false"`
    Status        int       `gorm:"default:0"` // 0: Offline, 1: Online, 2: Away
    LastHeartbeat time.Time `gorm:"index"`
    ClientInfo    string    `gorm:"size:255"`
    Lat           float64   `gorm:"default:0"`
    Lon           float64   `gorm:"default:0"`
    UpdatedAt     time.Time
}

func (*ActorStatus) TableName() string {
	return "touch_actor_status"
}
