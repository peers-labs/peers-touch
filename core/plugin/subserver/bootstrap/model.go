package bootstrap

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/util/id"
	"gorm.io/gorm"
)

// PeerInfo stores static/long-lived information about a peer
type PeerInfo struct {
	ID          uint64    `gorm:"primaryKey;type:bigint;comment:snowflake id"` // Snowflake 64-bit ID
	PeerID      string    `gorm:"uniqueIndex;size:255"`                        // Unique libp2p peer ID (Qm...)
	FirstSeenAt time.Time `gorm:"index"`                                       // First time we connected with this peer
	LastSeenAt  time.Time `gorm:"index"`                                       // Last time we connected with this peer
	IsActive    bool      `gorm:""`                                            // is this peer active
}

// TableName sets the database table name with bootstrap_ prefix
func (*PeerInfo) TableName() string {
	return "bootstrap_peer_info"
}

// BeforeCreate generates Snowflake ID before database insertion
func (p *PeerInfo) BeforeCreate(tx *gorm.DB) error {
	if p.ID == 0 {
		p.ID = id.NextID() // Assume you have a Snowflake ID generator function
	}
	return nil
}

// ConnectionInfo stores details about individual peer connections
type ConnectionInfo struct {
	ID              uint64     `gorm:"primaryKey;type:bigint;comment:snowflake id"` // Snowflake 64-bit ID
	PeerID          string     `gorm:"index;size:255"`                              // Foreign key to PeerInfo.PeerID
	IPv4            string     `gorm:"size:15"`                                     // IPv4/IPv6 address
	IPv6            string     `gorm:"size:39"`                                     // IPv4/IPv6 address
	Direction       string     `gorm:"size:10;check:direction IN ('inbound','outbound','unknown')"`
	LocalMultiAddr  string     `gorm:"size:512"` // Local multiaddress
	RemoteMultiAddr string     `gorm:"size:512"` // Remote multiaddress
	ConnectedAt     time.Time  // Connection start time
	DisconnectedAt  *time.Time `gorm:"default:null"` // Connection end time (null if active)
	IsActive        bool       `gorm:""`             // Connection status flag
}

func (*ConnectionInfo) TableName() string {
	return "bootstrap_connection_info"
}

// BeforeCreate generates Snowflake ID before database insertion
func (p *ConnectionInfo) BeforeCreate(tx *gorm.DB) error {
	if p.ID == 0 {
		p.ID = id.NextID() // Assume you have a Snowflake ID generator function
	}
	return nil
}
