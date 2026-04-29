package db

import "github.com/peers-labs/peers-touch/station/frame/core/registry"

type PeerAddrType = string

const (
	PeerAddrTypeStun      = registry.StationTypeStun
	PeerAddrTypeTurnRelay = registry.StationTypeTurnRelay
	PeerAddrTypeHttp      = registry.StationTypeHttp
)

type PeerAddress struct {
	ID     uint64       `gorm:"column:id;primaryKey"`
	PeerID string       `gorm:"column:peer_id;size:255;index"`
	Addr   string       `gorm:"column:addr;size:255"`
	Typ    PeerAddrType `gorm:"column:typ;size:255;index"`
}

func (*PeerAddress) TableName() string {
	return "touch_peer_address"
}
