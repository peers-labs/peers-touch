package db

import "github.com/dirty-bro-tech/peers-touch-go/core/registry"

type PeerAddrType = string

const (
	PeerAddrTypeStun      = registry.StationTypeStun
	PeerAddrTypeTurnRelay = registry.StationTypeTurnRelay
	PeerAddrTypeHttp      = registry.StationTypeHttp
)

type PeerAddress struct {
	// `gorm:"primaryKey"` indicates this field is the primary key
	ID uint64 `gorm:"primaryKey"`
	// `gorm:"size:255;index"` sets the maximum length of the string to 255 and adds an index for faster queries
	PeerID string `gorm:"size:255;index"`
	// `gorm:"size:255"` sets the maximum length of the string to 255
	Addr string `gorm:"size:255"`
	// `gorm:"size:255;index"` sets the maximum length of the string to 255 and adds an index for faster queries
	Typ PeerAddrType `gorm:"size:255;index"`
}

func (*PeerAddress) TableName() string {
	return "touch_peer_address"
}
