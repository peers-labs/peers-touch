package db

import (
	"encoding/json"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubObject represents an ActivityPub object in the database
type ActivityPubObject struct {
	ID            uint64     `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActivityPubID string     `gorm:"uniqueIndex;size:512;not null"`   // ActivityPub IRI
	Type          string     `gorm:"size:50;not null;index"`          // Object type (Note, Article, etc.)
	AttributedTo  string     `gorm:"size:512;index"`                  // Author/creator
	Name          string     `gorm:"size:255"`                        // Object name/title
	Content       string     `gorm:"type:text"`                       // Object content
	Summary       string     `gorm:"type:text"`                       // Object summary
	URL           string     `gorm:"size:512"`                        // Object URL
	Published     time.Time  `gorm:"index"`                           // When the object was published
	Updated       *time.Time `gorm:"index"`                           // When the object was last updated
	InReplyTo     uint64     `gorm:"index"`
	IsLocal       bool       `gorm:"default:false;not null;index"` // Whether this is a local object
	IsPublic      bool       `gorm:"default:true;not null;index"`  // Whether the object is public
	Metadata      string     `gorm:"type:json"`                    // Additional metadata as JSON

	LikesCount   int64 `gorm:"default:0;not null"` // Cached likes count
	RepliesCount int64 `gorm:"default:0;not null"` // Cached replies count
	SharesCount  int64 `gorm:"default:0;not null"` // Cached shares/reblogs count

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubObject) TableName() string {
	return "touch_ap_object"
}

func (o *ActivityPubObject) BeforeCreate(tx *gorm.DB) error {
	if o.ID == 0 {
		o.ID = id.NextID()
	}
	return nil
}

func (o *ActivityPubObject) SetMetadata(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	o.Metadata = string(jsonData)
	return nil
}

// GetMetadata retrieves the metadata field from JSON
func (o *ActivityPubObject) GetMetadata(data interface{}) error {
	if o.Metadata == "" {
		return nil
	}
	return json.Unmarshal([]byte(o.Metadata), data)
}
