package native

import "time"

// RegisterRecord represents a record of peer registration.
type RegisterRecord struct {
	// ID is the primary key of the register record, using a uint64 type.
	ID uint64 `gorm:"primaryKey;autoIncrement:false"`
	// PeerId is the unique identifier of the peer, with a maximum length of 255 characters and an index for faster queries.
	PeerId string `gorm:"size:255;index"`
	// PeerName is the name of the peer, with a maximum length of 255 characters.
	PeerName string `gorm:"size:255"`
	// Version indicates the version of the peer, with a maximum length of 50 characters.
	Version string `gorm:"size:50"`
	// EndStation represents the end - station information of the peer, stored as text without length limit.
	EndStation string `gorm:"type:text"`
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
