package domain

import (
	"errors"
	"time"
)

var (
	ErrPushIdempotencyConflict = errors.New("push mutation request id was reused with different input")
	ErrPushProviderConflict    = errors.New("push provider binding belongs to another actor device")
	ErrPushInstallConflict     = errors.New("push registration belongs to another app installation")
)

type Notification struct {
	ID            string
	RecipientPTID string
	ActorPTID     string
	Type          int32
	Category      int32
	Status        int32
	TargetType    string
	TargetID      string
	Title         string
	Body          string
	Metadata      map[string]string
	GroupKey      string
	CreatedAt     time.Time
	ReadAt        *time.Time
}

type NotificationGroup struct {
	GroupKey   string
	Type       int32
	Category   int32
	TargetType string
	TargetID   string
	Title      string
	Body       string
	Count      int32
	ActorPTIDs []string
	Latest     *Notification
	UpdatedAt  time.Time
}

type NotificationPreference struct {
	ActorPTID    string
	Category     int32
	Enabled      bool
	PushEnabled  bool
	SoundEnabled bool
	UpdatedAt    time.Time
}

type NotificationPreferencesSnapshot struct {
	Preferences []NotificationPreference
	Revision    uint64
}

type NotificationPreferencePatch struct {
	Category     int32
	Enabled      bool
	PushEnabled  bool
	SoundEnabled bool
}

type NotificationPreferencesUpdateOutcome int32

const (
	NotificationPreferencesUpdateOutcomeApplied NotificationPreferencesUpdateOutcome = iota + 1
	NotificationPreferencesUpdateOutcomeUnchanged
	NotificationPreferencesUpdateOutcomeConflict
)

type NotificationPreferencesUpdateResult struct {
	Outcome  NotificationPreferencesUpdateOutcome
	Snapshot NotificationPreferencesSnapshot
}

type PushChannel int32

const (
	PushChannelAPNS PushChannel = iota + 1
	PushChannelFCM
	PushChannelUnifiedPush
)

type PushEnvironment int32

const (
	PushEnvironmentDevelopment PushEnvironment = iota + 1
	PushEnvironmentProduction
)

type PushProviderBinding struct {
	Channel         PushChannel
	APNSToken       []byte
	APNSTopic       string
	FCMToken        string
	UnifiedEndpoint string
	UnifiedP256DH   []byte
	UnifiedAuth     []byte
}

type PushRegistration struct {
	RegistrationID        string
	ActorPTID             string
	DeviceID              string
	Channel               PushChannel
	Environment           PushEnvironment
	AppInstallEpochSHA256 []byte
	ProviderBindingSHA256 []byte
	CreatedAt             time.Time
	UpdatedAt             time.Time
	LastSuccessAt         *time.Time
}

type ProtectedPushBinding struct {
	Fingerprint []byte
	Ciphertext  []byte
	Nonce       []byte
	KeyVersion  uint32
}

type RegisterPushDeviceInput struct {
	RequestID             string
	ActorPTID             string
	DeviceID              string
	LifecycleGeneration   uint64
	AppInstallEpochSHA256 []byte
	Environment           PushEnvironment
	Binding               PushProviderBinding
}

type RegisterPushDeviceOutcome int32

const (
	RegisterPushDeviceOutcomeCreated RegisterPushDeviceOutcome = iota + 1
	RegisterPushDeviceOutcomeRotated
	RegisterPushDeviceOutcomeUnchanged
)

type RegisterPushDeviceResult struct {
	RequestID    string
	Outcome      RegisterPushDeviceOutcome
	Registration PushRegistration
}

type UnregisterPushDeviceInput struct {
	RequestID             string
	ActorPTID             string
	DeviceID              string
	LifecycleGeneration   uint64
	RegistrationID        string
	AppInstallEpochSHA256 []byte
}

type UnregisterPushDeviceOutcome int32

const (
	UnregisterPushDeviceOutcomeRemoved UnregisterPushDeviceOutcome = iota + 1
	UnregisterPushDeviceOutcomeAlreadyAbsent
)

type UnregisterPushDeviceResult struct {
	RequestID string
	Outcome   UnregisterPushDeviceOutcome
}

type UnreadCounts struct {
	Total      int32
	ByCategory map[int32]int32
}

// Category constants matching proto enum values
const (
	CategoryUnspecified = 0
	CategorySocial      = 1
	CategoryChat        = 2
	CategorySystem      = 3
	CategoryTask        = 4
)

// Status constants matching proto enum values
const (
	StatusUnspecified = 0
	StatusUnread      = 1
	StatusRead        = 2
	StatusArchived    = 3
)

// Type constants matching proto enum values
const (
	TypeFriendRequest  = 200
	TypeFriendAccepted = 201
	TypeFriendMessage  = 202
)
