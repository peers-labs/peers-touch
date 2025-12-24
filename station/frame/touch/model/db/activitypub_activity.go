package db

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	o "github.com/peers-labs/peers-touch/station/frame/object"
	"gorm.io/gorm"
)

// ActivityPubActivity represents an ActivityPub activity in the database
type ActivityPubActivity struct {
	ID            uint64    `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActivityPubID string    `gorm:"uniqueIndex;size:512;not null"`   // ActivityPub IRI
	Type          string    `gorm:"size:50;not null;index"`          // Activity type (Create, Follow, Like, etc.)
	ActorID       uint64    `gorm:"index"`
	ObjectID      uint64    `gorm:"index"`
	TargetID      uint64    `gorm:"index"`
	InReplyTo     uint64    `gorm:"index"`
	Text          string    `gorm:"type:text"`      // Content text (for Note)
	Sensitive     bool      `gorm:"default:false"`  // Sensitive content flag
	SpoilerText   string    `gorm:"type:text"`      // Content warning text
	Visibility    string    `gorm:"size:50;index"`  // Visibility (public, unlisted, private, direct)
	Language      string    `gorm:"size:10"`        // Language code
	Published     time.Time `gorm:"not null;index"` // When the activity was published
	Content       []byte    `gorm:"type:bytea"`
	IsLocal       bool      `gorm:"default:false;not null;index"` // Whether this is a local activity
	IsPublic      bool      `gorm:"default:true;not null;index"`  // Whether the activity is public

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubActivity) TableName() string {
	return "touch_ap_activity"
}

func (a *ActivityPubActivity) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}

// SetContent sets the activity content as JSON
func (a *ActivityPubActivity) SetContent(activity o.Activity) error {
	jsonData, err := json.Marshal(activity)
	if err != nil {
		return err
	}
	a.Content = gzipBytes(jsonData)
	return nil
}

// GetContent gets the activity content from JSON
func (a *ActivityPubActivity) GetContent() (*o.Activity, error) {
	if len(a.Content) == 0 {
		return nil, nil
	}
	bz, err := gunzipBytes(a.Content)
	if err != nil {
		return nil, err
	}
	var activity o.Activity
	if err := json.Unmarshal(bz, &activity); err != nil {
		return nil, err
	}
	return &activity, nil
}

func gzipBytes(b []byte) []byte {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	_, _ = zw.Write(b)
	_ = zw.Close()
	return buf.Bytes()
}

func gunzipBytes(b []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	var out bytes.Buffer
	_, _ = out.ReadFrom(zr)
	return out.Bytes(), nil
}
