package db

import "time"

type Peer struct {
	ID      uint64 `json:"id" gorm:"primary_key"`
	PeerID  string `json:"peer_id" gorm:"index"`
	Name    string `json:"name" gorm:"index"`
	Version string `json:"version" gorm:"index"`

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*Peer) TableName() string {
	return "touch_peer"
}
