package db

import "time"

// Connection represents a database connection
type Connection struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

// User represents a user in the system
type User struct {
	ID           uint64    `json:"id" gorm:"primaryKey"`
	Email        string    `json:"email" gorm:"uniqueIndex"`
	Name         string    `json:"name"`
	Password     string    `json:"-" gorm:"column:password"`
	PasswordHash string    `json:"-" gorm:"column:password_hash"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Actor represents an ActivityPub actor
type Actor struct {
	ID           uint64    `json:"id" gorm:"primaryKey"`
	UserID       uint64    `json:"user_id" gorm:"index"`
	Username     string    `json:"username" gorm:"uniqueIndex"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	Summary      string    `json:"summary"`
	PasswordHash string    `json:"-" gorm:"column:password_hash"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	
	// Relationship
	User *User `json:"user,omitempty" gorm:"foreignKey:UserID"`
}

// ActivityPubActor represents an ActivityPub actor in the database
type ActivityPubActor struct {
	ID                uint64    `json:"id" gorm:"primaryKey"`
	UserID            uint64    `json:"user_id" gorm:"index"`
	ActivityPubID     string    `json:"activitypub_id" gorm:"uniqueIndex"`
	Type              string    `json:"type"`
	Username          string    `json:"username" gorm:"uniqueIndex"`
	Name              string    `json:"name"`
	PreferredUsername string    `json:"preferred_username"`
	Summary           string    `json:"summary"`
	InboxURL          string    `json:"inbox_url"`
	OutboxURL         string    `json:"outbox_url"`
	FollowersURL      string    `json:"followers_url"`
	FollowingURL      string    `json:"following_url"`
	LikedURL          string    `json:"liked_url"`
	PublicKeyPem      string    `json:"public_key_pem" gorm:"type:text"`
	PrivateKeyPem     string    `json:"private_key_pem" gorm:"type:text"`
	IsLocal           bool      `json:"is_local"`
	IsActive          bool      `json:"is_active"`
	Metadata          string    `json:"metadata" gorm:"type:text"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
	
	// Relationship
	User *User `json:"user,omitempty" gorm:"foreignKey:UserID"`
}

// SetMetadata sets the metadata for the ActivityPub actor
func (a *ActivityPubActor) SetMetadata(metadata interface{}) error {
	// Implementation would serialize metadata to JSON string
	// For now, just return nil
	return nil
}

// PeerAddress represents a peer address in the database
type PeerAddress struct {
	ID        uint64    `json:"id" gorm:"primaryKey"`
	PeerID    string    `json:"peer_id" gorm:"index"`
	Address   string    `json:"address"`
	Addr      string    `json:"addr"`
	Port      int       `json:"port"`
	Type      string    `json:"type"`
	Typ       string    `json:"typ"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UserActivityPubProfile represents a user's ActivityPub profile
type UserActivityPubProfile struct {
	ID                        uint64             `json:"id" gorm:"primaryKey"`
	UserID                    uint64             `json:"user_id" gorm:"index"`
	ActivityPubActorID        uint64             `json:"activitypub_actor_id" gorm:"index"`
	ManuallyApprovesFollowers bool               `json:"manually_approves_followers"`
	Discoverable              bool               `json:"discoverable"`
	Indexable                 bool               `json:"indexable"`
	Bot                       bool               `json:"bot"`
	Locked                    bool               `json:"locked"`
	CreatedAt                 time.Time          `json:"created_at"`
	UpdatedAt                 time.Time          `json:"updated_at"`
	
	// Relationships
	User              *User              `json:"user,omitempty" gorm:"foreignKey:UserID"`
	ActivityPubActor  *ActivityPubActor  `json:"activitypub_actor,omitempty" gorm:"foreignKey:ActivityPubActorID"`
}