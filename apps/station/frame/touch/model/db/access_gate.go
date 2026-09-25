package db

import "time"

type AccessPolicy struct {
	ID                uint64 `gorm:"primaryKey;autoIncrement"`
	Mode              string `gorm:"size:32;not null;default:'open';uniqueIndex:idx_access_policy_singleton"`
	AllowedEmails     string `gorm:"type:text"`
	AllowedUsernames  string `gorm:"type:text"`
	AllowedActorPTIDs string `gorm:"column:allowed_actor_ptids;type:text"`
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
	ID                  string `gorm:"primaryKey;size:64"`
	Status              string `gorm:"size:32;not null;default:'pending';index"`
	SessionID           string `gorm:"size:128;index"`
	StationPeerID       string `gorm:"column:station_peer_id;size:255;not null;index"`
	ActorPTID           string `gorm:"column:actor_ptid;size:255;index"`
	ActorKind           int32  `gorm:"column:actor_kind"`
	ActorUsername       string `gorm:"size:128"`
	ActorEmail          string `gorm:"size:256"`
	AuthMethod          string `gorm:"column:auth_method;size:32"`
	StationURL          string `gorm:"size:256"`
	Platform            string `gorm:"size:32"`
	AppVersion          string `gorm:"size:32"`
	DeviceID            string `gorm:"size:128"`
	LifecycleGeneration uint64 `gorm:"column:lifecycle_generation;not null;default:0"`
	CompletedActionIDs  string `gorm:"column:completed_action_ids;type:text"`
	CurrentGateID       string `gorm:"size:64"`
	DecisionRevision    uint64 `gorm:"column:decision_revision;not null;default:1"`
	// InvitePassed records that this attempt redeemed a valid invite code, so the
	// invite.code gate stays satisfied across later decision passes.
	InvitePassed bool      `gorm:"not null;default:false"`
	CreatedAt    time.Time `gorm:"autoCreateTime"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"`
	ExpiresAt    time.Time `gorm:"index"`
}

func (*AccessAttempt) TableName() string { return "access_gate_attempts" }

// AccessGateSubmission is the durable idempotency record for one exact,
// schema-bound gate action. PayloadHash is a Station-keyed digest, so exact
// retries can be compared without exposing low-entropy credentials offline.
type AccessGateSubmission struct {
	AttemptID        string    `gorm:"column:attempt_id;primaryKey;size:64"`
	SubmissionID     string    `gorm:"column:submission_id;primaryKey;size:64"`
	GateID           string    `gorm:"column:gate_id;size:64;not null"`
	ActionID         string    `gorm:"column:action_id;size:64;not null"`
	PayloadHash      string    `gorm:"column:payload_hash;size:64;not null"`
	State            string    `gorm:"size:24;not null;index"`
	DecisionRevision uint64    `gorm:"column:decision_revision;not null;default:0"`
	CreatedAt        time.Time `gorm:"autoCreateTime"`
	UpdatedAt        time.Time `gorm:"autoUpdateTime"`
}

func (*AccessGateSubmission) TableName() string { return "access_gate_submissions" }

// OAuthAttempt is the durable, Station-owned binding for one native OAuth
// authorization. Provider credentials, callback codes, PKCE verifiers, nonces,
// and raw state values are deliberately never persisted.
type OAuthAttempt struct {
	ID                          string     `gorm:"primaryKey;size:64"`
	Provider                    string     `gorm:"size:32;not null;index"`
	StationPeerID               string     `gorm:"size:255;not null;index"`
	AccessAttemptID             string     `gorm:"size:64;not null;index"`
	GateID                      string     `gorm:"size:64;not null"`
	RedirectURI                 string     `gorm:"size:512;not null"`
	PKCEChallenge               string     `gorm:"size:128;not null"`
	NonceHash                   string     `gorm:"size:128;not null"`
	StateHash                   string     `gorm:"size:128;not null;uniqueIndex"`
	DeviceID                    string     `gorm:"size:128;not null"`
	LifecycleGeneration         uint64     `gorm:"not null"`
	AttemptSecretHash           []byte     `gorm:"type:bytea;not null"`
	CredentialDeliveryPublicKey []byte     `gorm:"type:bytea;not null"`
	LiveBindingKey              *string    `gorm:"size:512;uniqueIndex"`
	State                       int32      `gorm:"not null;index"`
	Result                      int32      `gorm:"not null"`
	CandidateID                 string     `gorm:"size:64;index"`
	ErrorCode                   string     `gorm:"size:64"`
	ClaimedAt                   *time.Time `gorm:""`
	ConsumedAt                  *time.Time `gorm:""`
	CreatedAt                   time.Time  `gorm:"autoCreateTime"`
	UpdatedAt                   time.Time  `gorm:"autoUpdateTime"`
	ExpiresAt                   time.Time  `gorm:"not null;index"`
}

func (*OAuthAttempt) TableName() string { return "oauth_attempts" }

// OAuthSessionCandidate is an inactive authentication result. It intentionally
// contains no bearer or refresh token and cannot authorize business APIs.
type OAuthSessionCandidate struct {
	ID                  string     `gorm:"primaryKey;size:64"`
	OAuthAttemptID      string     `gorm:"size:64;not null;uniqueIndex"`
	AccessAttemptID     string     `gorm:"size:64;not null;index"`
	StationPeerID       string     `gorm:"size:255;not null;index"`
	DeviceID            string     `gorm:"size:128;not null"`
	LifecycleGeneration uint64     `gorm:"not null"`
	LiveBindingKey      *string    `gorm:"size:512;uniqueIndex"`
	ActorID             uint64     `gorm:"not null"`
	ActorPTID           string     `gorm:"size:255;not null;index"`
	ActorKind           int32      `gorm:"not null"`
	ActorUsername       string     `gorm:"size:128"`
	ActorEmail          string     `gorm:"size:256"`
	State               string     `gorm:"size:32;not null;index"`
	SessionID           string     `gorm:"size:128;index"`
	DecisionRevision    uint64     `gorm:"not null;default:0"`
	CreatedAt           time.Time  `gorm:"autoCreateTime"`
	UpdatedAt           time.Time  `gorm:"autoUpdateTime"`
	ExpiresAt           time.Time  `gorm:"not null;index"`
	ActivatedAt         *time.Time `gorm:""`
}

func (*OAuthSessionCandidate) TableName() string { return "oauth_session_candidates" }

// OAuthCredentialEnvelope persists one recoverable encrypted credential
// delivery. Ciphertext is deleted only after the device acknowledges durable
// secure-store persistence.
type OAuthCredentialEnvelope struct {
	ID                       uint64    `gorm:"primaryKey;autoIncrement"`
	CandidateID              string    `gorm:"size:64;not null;uniqueIndex"`
	SessionID                string    `gorm:"size:128;not null;uniqueIndex"`
	StationPeerID            string    `gorm:"size:255;not null"`
	DeviceID                 string    `gorm:"size:128;not null"`
	LifecycleGeneration      uint64    `gorm:"not null"`
	ServerEphemeralPublicKey []byte    `gorm:"type:bytea;not null"`
	Nonce                    []byte    `gorm:"type:bytea;not null"`
	Ciphertext               []byte    `gorm:"type:bytea;not null"`
	CreatedAt                time.Time `gorm:"autoCreateTime"`
	ExpiresAt                time.Time `gorm:"not null;index"`
}

func (*OAuthCredentialEnvelope) TableName() string { return "oauth_credential_envelopes" }

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
