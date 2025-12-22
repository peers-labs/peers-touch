package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type Actor struct {
	ID                uint64 `gorm:"primary_key;autoIncrement:false"`                                       // Internal identity - cannot be changed
	PTID              string `gorm:"uniqueIndex;size:255;column:ptid"`                                      // Peers-Touch ID (JSON-LD: ptid)
	Namespace         string `gorm:"size:64;default:'peers';not null;uniqueIndex:idx_actor_name_namespace"` // Namespace for the actor name
	PreferredUsername string `gorm:"size:100;not null;uniqueIndex:idx_actor_name_namespace"`                // Actor's unique handle within namespace (JSON-LD: preferredUsername)
	Name              string `gorm:"size:100"`                                                              // Actor's display name (JSON-LD: name)
	Type              string `gorm:"size:32;default:'Person'"`                                              // ActivityPub Actor type
	Summary           string `gorm:"type:text"`                                                             // Bio/Summary (JSON-LD: summary)
	Icon              string `gorm:"size:512"`                                                              // Avatar URL (JSON-LD: icon)
	Image             string `gorm:"size:512"`                                                              // Header Image URL (JSON-LD: image)
	Email             string `gorm:"uniqueIndex;size:255;not null"`                                         // Unique email address
	PasswordHash      string `gorm:"size:128;not null"`                                                     // bcrypt hashed password
	// ActivityPub Standard Fields (Immutable URIs)
	Url       string `gorm:"size:512"`  // JSON-LD: url
	Inbox     string `gorm:"size:512"`  // JSON-LD: inbox
	Outbox    string `gorm:"size:512"`  // JSON-LD: outbox
	Followers string `gorm:"size:512"`  // JSON-LD: followers
	Following string `gorm:"size:512"`  // JSON-LD: following
	Liked     string `gorm:"size:512"`  // JSON-LD: liked
	Endpoints string `gorm:"type:text"` // JSON-LD: endpoints (JSON Object)
	// Keys (System Managed)
	PublicKey        string `gorm:"type:text"` // PEM Encoded Public Key
	PrivateKey       string `gorm:"type:text"` // PEM Encoded Private Key
	Libp2pPublicKeys string `gorm:"type:text"` // JSON list of Libp2p public keys (JSON-LD: libp2pPublicKeys)

	CreatedAt time.Time `gorm:"created_at"`
	UpdatedAt time.Time `gorm:"updated_at"`
}

func (*Actor) TableName() string {
	return "touch_actor"
}

func (a *Actor) BeforeCreate(tx *gorm.DB) error {
	if a.ID == 0 {
		a.ID = id.NextID()
	}
	return nil
}
