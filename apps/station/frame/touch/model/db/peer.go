package db

import "time"

type Peer struct {
	ID      uint64 `json:"id" gorm:"column:id;primary_key"`
	PeerID  string `json:"peer_id" gorm:"column:peer_id;index"`
	Name    string `json:"name" gorm:"column:name;index"`
	Version string `json:"version" gorm:"column:version;index"`

	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*Peer) TableName() string {
	return "touch_peer"
}
