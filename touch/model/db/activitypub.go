package db

import (
	"encoding/json"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/util/id"
	o "github.com/dirty-bro-tech/peers-touch-go/object"
	"gorm.io/gorm"
)

// ActivityPubActor represents an ActivityPub actor in the database
type ActivityPubActor struct {
	ID                uint64     `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActivityPubID     string     `gorm:"uniqueIndex;size:512;not null"`   // ActivityPub IRI
	Type              string     `gorm:"size:50;not null"`                // Actor type (Person, Service, etc.)
	Name              string     `gorm:"size:255"`                        // Display name
	PreferredUsername string     `gorm:"size:100;not null"`               // Username
	Summary           string     `gorm:"type:text"`                       // Bio/description
	InboxURL          string     `gorm:"size:512;not null"`               // Inbox endpoint
	OutboxURL         string     `gorm:"size:512;not null"`               // Outbox endpoint
	FollowersURL      string     `gorm:"size:512"`                        // Followers collection URL
	FollowingURL      string     `gorm:"size:512"`                        // Following collection URL
	LikedURL          string     `gorm:"size:512"`                        // Liked collection URL
	PublicKeyPem      string     `gorm:"type:text"`                       // Public key for verification
	PrivateKeyPem     string     `gorm:"type:text"`                       // Private key (for local actors)
	IsLocal           bool       `gorm:"default:false;not null"`          // Whether this is a local actor
	IsActive          bool       `gorm:"default:true;not null"`           // Whether the actor is active
	LastFetched       *time.Time `gorm:"index"`                           // Last time remote actor was fetched
	Metadata          string     `gorm:"type:json"`                       // Additional metadata as JSON

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubActor) TableName() string {
	return "activitypub_actors"
}

func (a *ActivityPubActor) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}

// ActivityPubActivity represents an ActivityPub activity in the database
type ActivityPubActivity struct {
	ID            uint64    `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActivityPubID string    `gorm:"uniqueIndex;size:512;not null"`   // ActivityPub IRI
	Type          string    `gorm:"size:50;not null;index"`          // Activity type (Create, Follow, Like, etc.)
	ActorID       string    `gorm:"size:512;not null;index"`         // Actor who performed the activity
	ObjectID      string    `gorm:"size:512;index"`                  // Target object ID
	TargetID      string    `gorm:"size:512;index"`                  // Target collection/actor ID
	Published     time.Time `gorm:"not null;index"`                  // When the activity was published
	Content       string    `gorm:"type:json"`                       // Full activity JSON
	IsLocal       bool      `gorm:"default:false;not null;index"`    // Whether this is a local activity
	IsPublic      bool      `gorm:"default:true;not null;index"`     // Whether the activity is public

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubActivity) TableName() string {
	return "activitypub_activities"
}

func (a *ActivityPubActivity) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}

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
	InReplyTo     string     `gorm:"size:512;index"`                  // Reply target
	IsLocal       bool       `gorm:"default:false;not null;index"`    // Whether this is a local object
	IsPublic      bool       `gorm:"default:true;not null;index"`     // Whether the object is public
	Metadata      string     `gorm:"type:json"`                       // Additional metadata as JSON

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubObject) TableName() string {
	return "activitypub_objects"
}

func (o *ActivityPubObject) BeforeCreate(tx *gorm.DB) error {
	if o.ID == 0 {
		o.ID = id.NextID()
	}
	return nil
}

// ActivityPubFollow represents a follow relationship in the database
type ActivityPubFollow struct {
	ID          uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	FollowerID  string `gorm:"size:512;not null;index"`         // Actor who is following
	FollowingID string `gorm:"size:512;not null;index"`         // Actor being followed
	ActivityID  string `gorm:"size:512;uniqueIndex"`            // Follow activity ID
	Accepted    bool   `gorm:"default:false;not null;index"`    // Whether the follow was accepted
	IsActive    bool   `gorm:"default:true;not null;index"`     // Whether the follow is still active

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubFollow) TableName() string {
	return "activitypub_follows"
}

func (f *ActivityPubFollow) BeforeCreate(tx *gorm.DB) error {
	if f.ID == 0 {
		f.ID = id.NextID()
	}
	return nil
}

// ActivityPubLike represents a like relationship in the database
type ActivityPubLike struct {
	ID         uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	ActorID    string `gorm:"size:512;not null;index"`         // Actor who liked
	ObjectID   string `gorm:"size:512;not null;index"`         // Object being liked
	ActivityID string `gorm:"size:512;uniqueIndex"`            // Like activity ID
	IsActive   bool   `gorm:"default:true;not null;index"`     // Whether the like is still active

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubLike) TableName() string {
	return "activitypub_likes"
}

func (l *ActivityPubLike) BeforeCreate(tx *gorm.DB) error {
	if l.ID == 0 {
		l.ID = id.NextID()
	}
	return nil
}

// ActivityPubCollection represents a collection item relationship in the database
type ActivityPubCollection struct {
	ID           uint64    `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	CollectionID string    `gorm:"size:512;not null;index"`         // Collection IRI (inbox, outbox, etc.)
	ItemID       string    `gorm:"size:512;not null;index"`         // Item IRI
	ItemType     string    `gorm:"size:50;not null;index"`          // Item type (Activity, Actor, Object)
	Position     int64     `gorm:"index"`                           // Position in ordered collections
	AddedAt      time.Time `gorm:"not null;index"`                  // When item was added to collection

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*ActivityPubCollection) TableName() string {
	return "activitypub_collections"
}

func (c *ActivityPubCollection) BeforeCreate(tx *gorm.DB) error {
	if c.ID == 0 {
		c.ID = id.NextID()
	}
	return nil
}

// Helper methods for JSON marshaling/unmarshaling

// SetMetadata sets the metadata field as JSON
func (a *ActivityPubActor) SetMetadata(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	a.Metadata = string(jsonData)
	return nil
}

// GetMetadata gets the metadata field from JSON
func (a *ActivityPubActor) GetMetadata(target interface{}) error {
	if a.Metadata == "" {
		return nil
	}
	return json.Unmarshal([]byte(a.Metadata), target)
}

// SetContent sets the activity content as JSON
func (a *ActivityPubActivity) SetContent(activity o.Activity) error {
	jsonData, err := json.Marshal(activity)
	if err != nil {
		return err
	}
	a.Content = string(jsonData)
	return nil
}

// GetContent gets the activity content from JSON
func (a *ActivityPubActivity) GetContent() (*o.Activity, error) {
	if a.Content == "" {
		return nil, nil
	}
	var activity o.Activity
	err := json.Unmarshal([]byte(a.Content), &activity)
	if err != nil {
		return nil, err
	}
	return &activity, nil
}

// SetMetadata sets the metadata field as JSON
func (o *ActivityPubObject) SetMetadata(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	o.Metadata = string(jsonData)
	return nil
}

// GetMetadata gets the metadata field from JSON
func (o *ActivityPubObject) GetMetadata(target interface{}) error {
	if o.Metadata == "" {
		return nil
	}
	return json.Unmarshal([]byte(o.Metadata), target)
}
