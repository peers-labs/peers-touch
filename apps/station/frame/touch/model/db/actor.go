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
	Kind              string `gorm:"column:kind;size:16;default:'p';not null"`                                        // ActorKind shorthand: p|g|o|s|a|n (identity.AccountType + 'n' for node)
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

	// Federation Identity (Phase A: federated user discovery).
	//
	// FederatedHandle is the canonical "@user@host" identifier. For local
	// actors it is computed at create-time from PreferredUsername plus the
	// home station's domain; for remote_cached rows it carries the verified
	// handle from the locator record. Indexed because cross-station
	// resolution lookups hit it directly.
	FederatedHandle string `gorm:"column:federated_handle;size:256;uniqueIndex:idx_actor_federated_handle"`
	// HomeStationPeerID is the libp2p PeerID of the authoritative station.
	// For local actors it equals this station's PeerID; for remote_cached
	// it is the source-of-truth station's PeerID. Used as the routing
	// target when forwarding HTTP through /relay/forward/{peer_id}/...
	HomeStationPeerID string `gorm:"column:home_station_peer_id;size:100"`
	// HomeStationDomain is the DNS-style HTTP origin of the home station,
	// without scheme. Stable per-actor (preserved across station-domain
	// rotations so handles do not drift).
	HomeStationDomain string `gorm:"column:home_station_domain;size:255"`
	// Origin distinguishes locally-authored rows from federation-cached
	// projections. Values: "local" | "remote_cached". Defaults to local
	// to keep the existing single-station code paths unchanged.
	Origin string `gorm:"column:origin;size:16;default:'local';not null"`
	// Visibility is the federation discoverability state. Numeric values
	// match the ActorVisibility enum: 1=hidden, 2=by_handle, 3=indexed.
	// Stored as int16 (not enum) so column comparisons are simple integers
	// and a future enum extension does not require a schema migration.
	// Default 0 (UNSPECIFIED) is treated as HIDDEN by the publisher until
	// the operator explicitly opts in.
	Visibility int16 `gorm:"column:visibility;default:0;not null"`
	// LocatorSeq is the monotonic per-actor counter included in every DHT
	// publish. Incremented on each Publish/Tombstone so the receiver can
	// dedupe overlapping records from racing publishers (e.g. dual-region
	// stations). Never decreased — a key rotation resets via the
	// out-of-scope handover envelope, not by routine writes.
	LocatorSeq uint64 `gorm:"column:locator_seq;default:0;not null"`

	// CachedUntilUnixMs is the wall-clock at which the cached profile for
	// this row stops being authoritative. Phase D — only consulted for
	// rows where Origin == "remote_cached"; local rows leave it at 0 and
	// the resolver short-circuits the freshness check.
	//
	// On remote resolve, the resolver upserts this column to the
	// envelope's expires_at_unix_ms. On the next read the federation
	// cache returns the row directly iff Now < CachedUntilUnixMs;
	// otherwise it falls through to a fresh DHT + relay-forward fetch.
	// This is best-effort — a missing or expired row is never an error,
	// just a cache miss.
	CachedUntilUnixMs int64 `gorm:"column:cached_until_unix_ms;default:0;not null"`

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
	if a.Kind == "" {
		a.Kind = "p"
	}
	return nil
}
