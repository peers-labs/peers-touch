package db

import "time"

type AccessPolicy struct {
	ID               uint64 `gorm:"primaryKey;autoIncrement"`
	Mode             string `gorm:"size:32;not null;default:'open';uniqueIndex:idx_access_policy_singleton"`
	AllowedEmails    string `gorm:"type:text"`
	AllowedUsernames string `gorm:"type:text"`
	AllowedActorIDs  string `gorm:"type:text"`
	// EnabledGates is a comma-separated list of AccessGateType enum values that
	// pins the evaluation order. Empty means the Station applies its built-in
	// default chain.
	EnabledGates string `gorm:"type:text"`
	// SelfServiceInvite enables the invite.code gate for holders of a valid
	// Station-issued invite code.
	SelfServiceInvite bool      `gorm:"not null;default:false"`
	UpdatedBy         string    `gorm:"size:128"`
	CreatedAt         time.Time `gorm:"autoCreateTime"`
	UpdatedAt         time.Time `gorm:"autoUpdateTime"`
}

func (*AccessPolicy) TableName() string { return "access_gate_policies" }

// AccessAttempt is the persisted lifecycle record for one client's attempt to
// enter the Station. It replaces the previous in-memory map so attempts survive
// a Station restart and become observable for audit. Status follows the gate
// chain state machine: pending -> action_required -> granted | blocked | failed,
// with cancelled and expired as terminal client/timeout outcomes.
type AccessAttempt struct {
	ID            string `gorm:"primaryKey;size:64"`
	Status        string `gorm:"size:32;not null;default:'pending';index"`
	SessionID     string `gorm:"size:128;index"`
	ActorID       int64  `gorm:"index"`
	ActorUsername string `gorm:"size:128"`
	ActorEmail    string `gorm:"size:256"`
	StationURL    string `gorm:"size:256"`
	Platform      string `gorm:"size:32"`
	AppVersion    string `gorm:"size:32"`
	DeviceID      string `gorm:"size:128"`
	CurrentGateID string `gorm:"size:64"`
	// InvitePassed records that this attempt redeemed a valid invite code, so the
	// invite.code gate stays satisfied across later decision passes.
	InvitePassed bool      `gorm:"not null;default:false"`
	CreatedAt    time.Time `gorm:"autoCreateTime"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"`
	ExpiresAt    time.Time `gorm:"index"`
}

func (*AccessAttempt) TableName() string { return "access_gate_attempts" }

// AccessInviteCode is a Station-issued, Dashboard-managed credential that lets a
// holder pass the invite.code gate. Codes are never created or listed by
// clients; redemption increments UsedCount under the Station's control.
type AccessInviteCode struct {
	ID         string     `gorm:"primaryKey;size:64"`
	Code       string     `gorm:"size:64;not null;uniqueIndex"`
	Note       string     `gorm:"size:256"`
	MaxUses    int        `gorm:"not null;default:0"`
	UsedCount  int        `gorm:"not null;default:0"`
	Revoked    bool       `gorm:"not null;default:false;index"`
	CreatedBy  string     `gorm:"size:128"`
	CreatedAt  time.Time  `gorm:"autoCreateTime"`
	ExpiresAt  *time.Time `gorm:""`
	LastUsedAt *time.Time `gorm:""`
}

func (*AccessInviteCode) TableName() string { return "access_gate_invite_codes" }
