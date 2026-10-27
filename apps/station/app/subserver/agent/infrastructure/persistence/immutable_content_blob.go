package persistence

import "time"

// ImmutableContentBlob is the global content-addressed byte store shared by
// versioned Agent capabilities. Domain-specific revision rows reference the
// hash; they must not duplicate this body in another generic content table.
type ImmutableContentBlob struct {
	ContentHash string    `gorm:"primaryKey;type:varchar(64)"`
	Content     []byte    `gorm:"not null;type:bytea"`
	Size        uint64    `gorm:"not null"`
	CreatedBy   string    `gorm:"not null;type:text;index"`
	CreatedAt   time.Time `gorm:"not null"`
}

func (ImmutableContentBlob) TableName() string { return "agent_immutable_content_blobs" }
