// Package persistence owns the Station tables of a login approval transaction.
// The Station stores only capability hashes and HPKE ciphertext; it never
// holds a claimant possession secret, Actor seed plaintext or session token.
package persistence

import (
	"time"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"gorm.io/gorm"
)

// Transaction is the aggregate row. One row authorizes one installation.
type Transaction struct {
	ID                 string                    `gorm:"primaryKey;size:64"`
	StationPeerID      string                    `gorm:"column:station_peer_id;size:255;not null;index:idx_login_approval_actor,priority:1"`
	UserID             uint64                    `gorm:"column:user_id;not null;index:idx_login_approval_actor,priority:2"`
	ActorPTID          string                    `gorm:"column:actor_ptid;size:255;not null;index:idx_login_approval_actor,priority:3"`
	AccessAttemptID    string                    `gorm:"column:access_attempt_id;size:64;not null;index"`
	AccessRevision     uint64                    `gorm:"column:access_revision;not null"`
	RequestID          string                    `gorm:"column:request_id;size:128;not null;index:idx_login_approval_request,priority:1"`
	RequestDigest      []byte                    `gorm:"column:request_digest"`
	ClaimantDeviceID   string                    `gorm:"column:claimant_device_id;size:128;not null"`
	Platform           string                    `gorm:"column:platform;size:16;not null"`
	DeviceLabel        string                    `gorm:"column:device_label;size:128"`
	ClaimantHPKEKey    []byte                    `gorm:"column:claimant_hpke_key"`
	ClaimantSigningKey []byte                    `gorm:"column:claimant_signing_key"`
	ComparisonCode     string                    `gorm:"column:comparison_code;size:8;not null"`
	State              pb.LoginApprovalState     `gorm:"column:state;not null;index"`
	Reason             pb.LoginApprovalErrorCode `gorm:"column:reason"`
	Revision           uint64                    `gorm:"column:revision;not null"`
	ApproverDeviceID   string                    `gorm:"column:approver_device_id;size:128"`
	IdentityEnvelope   []byte                    `gorm:"column:identity_envelope"`
	ApproverSignature  []byte                    `gorm:"column:approver_signature"`
	TranscriptDigest   []byte                    `gorm:"column:transcript_digest"`
	CreatedAt          time.Time                 `gorm:"column:created_at;index"`
	ExpiresAt          time.Time                 `gorm:"column:expires_at;index"`
}

func (Transaction) TableName() string { return "login_approval_transactions" }

// Capability stores only the SHA-256 hash of the claimant possession secret.
type Capability struct {
	ApprovalID     string    `gorm:"primaryKey;size:64"`
	CapabilityHash []byte    `gorm:"column:capability_hash;not null"`
	CreatedAt      time.Time `gorm:"column:created_at"`
}

func (Capability) TableName() string { return "login_approval_capabilities" }

// Audit is append-only and never mutated.
type Audit struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement"`
	ApprovalID       string    `gorm:"column:approval_id;size:64;not null;index"`
	ActorPTID        string    `gorm:"column:actor_ptid;size:255;not null"`
	Event            string    `gorm:"column:event;size:32;not null"`
	ApproverDeviceID string    `gorm:"column:approver_device_id;size:128"`
	Revision         uint64    `gorm:"column:revision;not null"`
	CreatedAt        time.Time `gorm:"column:created_at"`
}

func (Audit) TableName() string { return "login_approval_audit" }

func Migrate(database *gorm.DB) error {
	return database.AutoMigrate(&Transaction{}, &Capability{}, &Audit{})
}
