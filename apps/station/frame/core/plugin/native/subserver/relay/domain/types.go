package domain

import "time"

// JWT subject prefixes used across all relay layers (handler, service, TCP handshake).
// Single source of truth — never duplicate these strings elsewhere.
const (
	SubjectRelayInvite = "relay-invite:"
	SubjectRelayAccess = "relay-access:"
	SubjectRelayClient = "relay-client:"
)

// Mount represents a station that is mounted to the relay.
// Pure domain model — no framework or persistence annotations.
type Mount struct {
	ID             uint64
	StationPeerID  string
	Label          string
	Status         MountStatus
	MaxClients     int32
	BandwidthLimit int64
	InviteID       uint64
	LastHeartbeat  time.Time
	MountedAt      time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type MountStatus int32

const (
	MountStatusOnline  MountStatus = 1
	MountStatusOffline MountStatus = 2
)

// Invite represents a one-time token that a station uses to register.
type Invite struct {
	ID             uint64
	Token          string
	StationPeerID  string
	Label          string
	MaxClients     int32
	BandwidthLimit int64
	Status         InviteStatus
	ConsumedBy     string
	ConsumedAt     *time.Time
	ExpiresAt      time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type InviteStatus int32

const (
	InviteStatusActive   InviteStatus = 1
	InviteStatusConsumed InviteStatus = 2
	InviteStatusExpired  InviteStatus = 3
	InviteStatusRevoked  InviteStatus = 4
)

// ICEServerInfo carries TURN/STUN credentials returned on registration.
type ICEServerInfo struct {
	URLs       []string
	Username   string
	Credential string
	Source     string
	Priority   int
}
