package db

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/util/id"
	"gorm.io/gorm"
)

// ActivityPubUser extends the basic User model with ActivityPub-specific fields
type ActivityPubUser struct {
	ID       uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	UserID   uint64 `gorm:"uniqueIndex;not null"`            // Foreign key to User table
	ActorID  string `gorm:"uniqueIndex;size:512;not null"`   // ActivityPub actor ID (URI)
	ActorType string `gorm:"size:50;not null;default:'Person'"` // Actor type (Person, Service, etc.)

	// Profile information
	DisplayName string `gorm:"size:255"` // Display name (can be different from username)
	Summary     string `gorm:"type:text"` // Bio/description
	IconURL     string `gorm:"size:512"` // Avatar/profile picture URL
	ImageURL    string `gorm:"size:512"` // Header/banner image URL

	// ActivityPub endpoints
	InboxURL     string `gorm:"size:512;not null"` // Inbox endpoint
	OutboxURL    string `gorm:"size:512;not null"` // Outbox endpoint
	FollowersURL string `gorm:"size:512"`          // Followers collection URL
	FollowingURL string `gorm:"size:512"`          // Following collection URL
	LikedURL     string `gorm:"size:512"`          // Liked collection URL

	// Cryptographic keys for HTTP signatures
	PublicKeyID  string `gorm:"size:512"` // Public key ID
	PublicKeyPem string `gorm:"type:text"` // PEM-encoded public key
	PrivateKeyPem string `gorm:"type:text"` // PEM-encoded private key (encrypted)

	// ActivityPub settings
	ManuallyApprovesFollowers bool      `gorm:"default:false"` // Whether follow requests need approval
	Discoverable              bool      `gorm:"default:true"`  // Whether the actor should be discoverable
	Indexable                 bool      `gorm:"default:true"`  // Whether the actor should be indexed by search engines
	Bot                       bool      `gorm:"default:false"` // Whether this is a bot account
	Locked                    bool      `gorm:"default:false"` // Whether the account is locked (private)
	Suspended                 bool      `gorm:"default:false"` // Whether the account is suspended
	Silenced                  bool      `gorm:"default:false"` // Whether the account is silenced

	// Timestamps
	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`

	// Relationships
	User *User `gorm:"foreignKey:UserID;references:ID"`
}

func (*ActivityPubUser) TableName() string {
	return "touch_activitypub_user"
}

func (apu *ActivityPubUser) BeforeCreate(tx *gorm.DB) error {
	if apu.ID == 0 {
		apu.ID = id.NextID()
	}
	return nil
}

// ActivityPubUserProfile represents a user's public ActivityPub profile
type ActivityPubUserProfile struct {
	ActorID     string `json:"id"`
	Type        string `json:"type"`
	Username    string `json:"preferredUsername"`
	DisplayName string `json:"name,omitempty"`
	Summary     string `json:"summary,omitempty"`
	IconURL     string `json:"icon,omitempty"`
	ImageURL    string `json:"image,omitempty"`
	InboxURL    string `json:"inbox"`
	OutboxURL   string `json:"outbox"`
	FollowersURL string `json:"followers,omitempty"`
	FollowingURL string `json:"following,omitempty"`
	LikedURL     string `json:"liked,omitempty"`
	PublicKeyID  string `json:"publicKeyId,omitempty"`
	PublicKeyPem string `json:"publicKeyPem,omitempty"`
	ManuallyApprovesFollowers bool `json:"manuallyApprovesFollowers"`
	Discoverable bool `json:"discoverable"`
	Indexable    bool `json:"indexable"`
	Bot          bool `json:"bot"`
	Locked       bool `json:"locked"`
	CreatedAt    time.Time `json:"published"`
	UpdatedAt    time.Time `json:"updated"`
}

// ToProfile converts ActivityPubUser to ActivityPubUserProfile
func (apu *ActivityPubUser) ToProfile(username string) *ActivityPubUserProfile {
	return &ActivityPubUserProfile{
		ActorID:     apu.ActorID,
		Type:        apu.ActorType,
		Username:    username,
		DisplayName: apu.DisplayName,
		Summary:     apu.Summary,
		IconURL:     apu.IconURL,
		ImageURL:    apu.ImageURL,
		InboxURL:    apu.InboxURL,
		OutboxURL:   apu.OutboxURL,
		FollowersURL: apu.FollowersURL,
		FollowingURL: apu.FollowingURL,
		LikedURL:     apu.LikedURL,
		PublicKeyID:  apu.PublicKeyID,
		PublicKeyPem: apu.PublicKeyPem,
		ManuallyApprovesFollowers: apu.ManuallyApprovesFollowers,
		Discoverable: apu.Discoverable,
		Indexable:    apu.Indexable,
		Bot:          apu.Bot,
		Locked:       apu.Locked,
		CreatedAt:    apu.CreatedAt,
		UpdatedAt:    apu.UpdatedAt,
	}
}

// UserActivityPubProfile represents the relationship between User and ActivityPubActor
type UserActivityPubProfile struct {
	ID              uint64 `gorm:"primary_key;autoIncrement:false"` // Snowflake ID
	UserID          uint64 `gorm:"uniqueIndex;not null"`            // Foreign key to User table
	ActivityPubActorID uint64 `gorm:"uniqueIndex;not null"`         // Foreign key to ActivityPubActor table

	// Profile settings specific to this user's ActivityPub presence
	ManuallyApprovesFollowers bool `gorm:"default:false"` // Whether follow requests need approval
	Discoverable              bool `gorm:"default:true"`  // Whether the actor should be discoverable
	Indexable                 bool `gorm:"default:true"`  // Whether the actor should be indexed by search engines
	Bot                       bool `gorm:"default:false"` // Whether this is a bot account
	Locked                    bool `gorm:"default:false"` // Whether the account is locked (private)

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`

	// Relationships
	User            *User             `gorm:"foreignKey:UserID;references:ID"`
	ActivityPubActor *ActivityPubActor `gorm:"foreignKey:ActivityPubActorID;references:ID"`
}

func (*UserActivityPubProfile) TableName() string {
	return "touch_user_activitypub_profile"
}

func (uapp *UserActivityPubProfile) BeforeCreate(tx *gorm.DB) error {
	if uapp.ID == 0 {
		uapp.ID = id.NextID()
	}
	return nil
}