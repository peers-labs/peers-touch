package persistence

import (
	"time"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"gorm.io/gorm"
)

// Offer stores the aggregate and opaque deliveries. RedactedOffer has its
// scan capability empty; reconstitution verifies the persisted capability hash.
type Offer struct {
	ID                      string `gorm:"primaryKey;size:64"`
	ActorPTID               string `gorm:"column:actor_ptid;size:255;index;not null;uniqueIndex:uidx_link_request"`
	DesktopSessionID        string `gorm:"size:100;not null;uniqueIndex:uidx_link_request"`
	DesktopDeviceID         string `gorm:"size:128;not null"`
	RequestID               string `gorm:"size:128;not null;uniqueIndex:uidx_link_request"`
	RequestDigest           []byte
	StationPeerID           string `gorm:"size:255;not null"`
	CapabilityKeyID         string `gorm:"size:80;not null"`
	ScanCapabilityHash      []byte
	RedactedOffer           []byte
	LocatorTemplate         []byte
	BootstrapPublication    []byte
	State                   pb.DeviceLinkState `gorm:"not null"`
	Reason                  pb.DeviceLinkErrorCode
	Revision                uint64 `gorm:"not null"`
	ApprovalRevision        uint64
	SelectedClaimID         string `gorm:"size:64"`
	ApprovalTranscript      []byte
	ApprovalRequestDigest   []byte
	IdentityEnvelope        []byte
	DesktopSignature        []byte
	PendingEnrollment       []byte
	CredentialEnvelope      []byte
	CredentialSignature     []byte
	CredentialAuthority     []byte
	CredentialDigest        []byte
	CredentialRevision      uint64
	LastAccessRequestDigest []byte
	DeliveryID              string    `gorm:"size:64"`
	SessionID               string    `gorm:"size:100"`
	LiveActor               *string   `gorm:"size:255;uniqueIndex"`
	CreatedAt               time.Time `gorm:"index"`
	ExpiresAt               time.Time `gorm:"index"`
}

func (Offer) TableName() string { return "device_link_offers" }

type Claim struct {
	ID              string `gorm:"primaryKey;size:64"`
	OfferID         string `gorm:"size:64;not null;index;uniqueIndex:uidx_link_claim_request"`
	RequestID       string `gorm:"size:128;not null;uniqueIndex:uidx_link_claim_request"`
	DeviceID        string `gorm:"size:128;not null"`
	KeyDigest       []byte `gorm:"not null;uniqueIndex:uidx_link_claim_request"`
	Statement       []byte
	Signature       []byte
	CapabilityHash  []byte
	AccessAttemptID string `gorm:"size:64;not null"`
	AccessRevision  uint64
	ProfileRevision uint64
	State           pb.DeviceLinkState
	CreatedAt       time.Time
}

func (Claim) TableName() string { return "device_link_claims" }

func Migrate(database *gorm.DB) error {
	return database.AutoMigrate(&Offer{}, &Claim{})
}
