package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

type Actor struct {
	ID                uint64 `gorm:"column:id;primary_key;autoIncrement:false"`                                       // Internal identity - cannot be changed
	PTID              string `gorm:"column:ptid;uniqueIndex;size:255"`                                                // Peers-Touch ID (JSON-LD: ptid)
	Namespace         string `gorm:"column:namespace;size:64;default:'peers';not null;uniqueIndex:idx_actor_name_namespace"` // Namespace for the actor name
	PreferredUsername string `gorm:"column:preferred_username;size:100;not null;uniqueIndex:idx_actor_name_namespace"`       // Actor's unique handle within namespace (JSON-LD: preferredUsername)
	Name              string `gorm:"column:name;size:100"`                                                            // Actor's display name (JSON-LD: name)
	Type              string `gorm:"column:type;size:32;default:'Person'"`                                            // ActivityPub Actor type
	Summary           string `gorm:"column:summary;type:text"`                                                        // Bio/Summary (JSON-LD: summary)
	Icon              string `gorm:"column:icon;size:512"`                                                            // Avatar URL (JSON-LD: icon)
	Image             string `gorm:"column:image;size:512"`                                                           // Header Image URL (JSON-LD: image)
	Email             string `gorm:"column:email;uniqueIndex;size:255;not null"`                                      // Unique email address
	PasswordHash      string `gorm:"column:password_hash;size:128;not null"`                                          // bcrypt hashed password
	// ActivityPub Standard Fields (Immutable URIs)
	Url       string `gorm:"column:url;size:512"`       // JSON-LD: url
	Inbox     string `gorm:"column:inbox;size:512"`     // JSON-LD: inbox
	Outbox    string `gorm:"column:outbox;size:512"`    // JSON-LD: outbox
	Followers string `gorm:"column:followers;size:512"` // JSON-LD: followers
	Following string `gorm:"column:following;size:512"` // JSON-LD: following
	Liked     string `gorm:"column:liked;size:512"`     // JSON-LD: liked
	Endpoints string `gorm:"column:endpoints;type:text"` // JSON-LD: endpoints (JSON Object)
	// Keys (System Managed)
	PublicKey        string `gorm:"column:public_key;type:text"`        // PEM Encoded Public Key
	PrivateKey       string `gorm:"column:private_key;type:text"`       // PEM Encoded Private Key
	Libp2pPublicKeys string `gorm:"column:libp2p_public_keys;type:text"` // JSON list of Libp2p public keys (JSON-LD: libp2pPublicKeys)

	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
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
