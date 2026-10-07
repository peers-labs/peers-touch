package domain

import "time"

// JWT subject prefixes used across all relay layers (handler, service, TCP handshake).
// Single source of truth — never duplicate these strings elsewhere.
const (
	SubjectRelayAccess = "relay-access:"

	MountCredentialAudience = "peers-touch-relay-mount"

	ScopeMountConnect = "relay.mount.connect"
	ScopeMountRotate  = "relay.mount.rotate"
	ScopeRoutePublish = "relay.route.publish"
	ScopePeerTunnel   = "relay.peer.tunnel"

	StationIdentityDomain       = "peers-touch/station-identity/v1\x00"
	EnrollmentChallengeDomain   = "peers-touch/relay-enrollment-challenge/v1\x00"
	EnrollmentChallengeByteSize = 32
)

// Mount represents a station that is mounted to the relay.
// Pure domain model — no framework or persistence annotations.
type Mount struct {
	ID             uint64
	StationPeerID  string
	HostPublicKey  []byte
	Label          string
	Status         MountStatus
	Generation     uint64
	CredentialJTI  string
	MaxClients     int32
	BandwidthLimit int64
	InviteID       uint64
	LastHeartbeat  time.Time
	MountedAt      time.Time
	RevokedAt      *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type MountStatus int32

const (
	MountStatusOnline  MountStatus = 1
	MountStatusOffline MountStatus = 2
	MountStatusRevoked MountStatus = 3
)

// Invite represents a one-time token that a station uses to register.
type Invite struct {
	ID                    uint64
	SecretDigest          string
	IntendedStationPeerID string
	Label                 string
	MaxClients            int32
	BandwidthLimit        int64
	Status                InviteStatus
	ConsumedBy            string
	ConsumedAt            *time.Time
	ExpiresAt             time.Time
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

type InviteStatus int32

const (
	InviteStatusActive   InviteStatus = 1
	InviteStatusConsumed InviteStatus = 2
	InviteStatusExpired  InviteStatus = 3
	InviteStatusRevoked  InviteStatus = 4
)

type ChallengeOperation string

const (
	ChallengeOperationEnroll ChallengeOperation = "enroll"
	ChallengeOperationRotate ChallengeOperation = "rotate"
)

// EnrollmentChallenge is a short-lived, single-use Relay challenge. Challenge
// is the exact 32-byte value that the Station identity endpoint must sign.
type EnrollmentChallenge struct {
	ID            string
	Operation     ChallengeOperation
	InviteID      uint64
	InviteDigest  string
	RelayPeerID   string
	StationPeerID string
	MountID       uint64
	Generation    uint64
	CredentialJTI string
	Label         string
	Nonce         []byte
	Challenge     []byte
	IssuedAt      time.Time
	ExpiresAt     time.Time
}

type StationIdentityProof struct {
	ChallengeID   string `json:"challenge_id"`
	Statement     []byte `json:"statement_bytes"`
	HostPublicKey []byte `json:"host_public_key"`
	Signature     []byte `json:"signature"`
}

type MountCredential struct {
	Token         string
	RelayPeerID   string
	StationPeerID string
	MountID       uint64
	Generation    uint64
	JTI           string
	ExpiresAt     time.Time
}

type MountIdentity struct {
	RelayPeerID   string
	StationPeerID string
	MountID       uint64
	Generation    uint64
	JTI           string
	Scopes        []string
	ExpiresAt     time.Time
}

// ICEServerInfo carries TURN/STUN credentials returned on registration.
type ICEServerInfo struct {
	URLs       []string
	Username   string
	Credential string
	Source     string
	Priority   int
}
