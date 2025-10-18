package native

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/peers-touch/peers-touch-go/core/registry"
	"github.com/peers-touch/peers-touch-go/core/util/id"
	"gorm.io/gorm"
)

// RegisterRecord represents a record of peer registration.
type RegisterRecord struct {
	// ID is the primary key of the register record, using a uint64 type.
	ID uint64 `gorm:"primaryKey;autoIncrement:false"`
	// PeerId is the unique identifier of the peer, with a maximum length of 255 characters and an index for faster queries.
	PeerId string `gorm:"size:255;index"`
	// PeerName is the name of the peer, with a maximum length of 255 characters.
	PeerName string `gorm:"size:255"`
	// Libp2pId is the libp2p identifier of the peer, with a maximum length of 255 characters.
	Libp2pId string `gorm:"size:255"`
	// Version indicates the version of the peer, with a maximum length of 50 characters.
	Version string `gorm:"size:50"`
	// EndStation represents the end - station information of the peer, stored as text without length limit.
	EndStation string `gorm:"type:text"`
	// EndStation represents the end - station information of the peer, stored as text without length limit.
	EndStationMap map[string]*registry.EndStation `gorm:"-"`
	// UpdatedAt records the time when the record was last updated.
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
	// CreatedAt records the time when the record was created.
	CreatedAt time.Time `gorm:"autoCreateTime"`
	// Signature is the signature of the record, with a maximum length of 512 characters.
	Signature string `gorm:"size:512"`
}

func (r *RegisterRecord) TableName() string {
	return "core_register_record"
}

func (r *RegisterRecord) BeforeCreate(tx *gorm.DB) error {
	if r.ID == 0 {
		r.ID = id.NextID()
	}
	return nil
}

func (r *RegisterRecord) BeforeSave(tx *gorm.DB) error {
	stationBytes, err := json.Marshal(r.EndStationMap)
	if err != nil {
		return fmt.Errorf("invalid end station: %s", err)
	}

	r.EndStation = string(stationBytes)

	return nil
}
