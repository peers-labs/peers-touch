package domain

import (
	"context"
	"errors"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var (
	ErrNotFound             = errors.New("messaging: record not found")
	ErrCommandConflict      = errors.New("messaging: command identity conflicts with persisted bytes")
	ErrConversationState    = errors.New("messaging: conversation is not active")
	ErrSenderUnauthorized   = errors.New("messaging: sender endpoint is not active")
	ErrDeliverySet          = errors.New("messaging: prepared payloads do not match required endpoints")
	ErrStaleDeliveryPlan    = errors.New("messaging: delivery plan is stale")
	ErrAuthorityPlanStale   = errors.New("messaging: authority plan is stale")
	ErrAuthorityPlanExpired = errors.New("messaging: authority plan is expired")
	ErrUnsupportedCommand   = errors.New("messaging: command is not supported")
)

type AuthorityConversationKind int32

const (
	AuthorityConversationKindUnspecified AuthorityConversationKind = 0
	AuthorityConversationKindDirect      AuthorityConversationKind = 1
	AuthorityConversationKindGroup       AuthorityConversationKind = 2
)

type AuthorityConversation struct {
	ConversationID  string
	Kind            AuthorityConversationKind
	Name            string
	OwnerPTID       string
	CurrentSequence int64
	MembershipEpoch int64
	MlsEpoch        int64
	Active          bool
}

type AuthorityConversationView struct {
	Conversation *AuthorityConversation
	MemberPTIDs  []string
}

type AuthorityMemberDevice struct {
	Endpoint *chat.CryptoEndpoint
	Active   bool
}

type AuthorityMember struct {
	PTID   string
	Role   string
	Active bool
}

type AuthorityCommandReceipt struct {
	ConversationID string
	CommandID      string
	CommandSHA256  []byte
	EventBytes     []byte
	CreatedAt      time.Time
}

type AuthorityRepository interface {
	CreateConversation(ctx context.Context, conversation *AuthorityConversation) (bool, error)
	AddMember(
		ctx context.Context,
		conversationID string,
		ptid string,
		role string,
		joinedSequence int64,
	) error
	AddMemberDevice(
		ctx context.Context,
		conversationID string,
		endpoint *chat.CryptoEndpoint,
		joinedSequence int64,
	) error
	RemoveMember(ctx context.Context, conversationID string, ptid string, leftSequence int64) error
	RemoveMemberDevice(
		ctx context.Context,
		conversationID string,
		endpoint *chat.CryptoEndpoint,
		leftSequence int64,
	) error
	GetMember(ctx context.Context, conversationID string, ptid string) (*AuthorityMember, error)
	ListActiveMembers(ctx context.Context, conversationID string) ([]AuthorityMember, error)
	ListConversationsForActor(ctx context.Context, ptid string) ([]AuthorityConversationView, error)
	LockConversation(ctx context.Context, conversationID string) (*AuthorityConversation, error)
	ListActiveMemberDevices(ctx context.Context, conversationID string) ([]AuthorityMemberDevice, error)
	GetLastEvent(ctx context.Context, conversationID string) (*chat.ConversationEvent, error)
	GetCommandReceipt(
		ctx context.Context,
		conversationID string,
		commandID string,
	) (*AuthorityCommandReceipt, error)
	AppendEvent(ctx context.Context, event *chat.ConversationEvent) error
	AdvanceEpochs(
		ctx context.Context,
		conversationID string,
		fromMembershipEpoch int64,
		fromMlsEpoch int64,
		toMembershipEpoch int64,
		toMlsEpoch int64,
	) error
	CreateCommandReceipt(ctx context.Context, receipt *AuthorityCommandReceipt) error
}

type DeviceDirectory interface {
	IsActive(ctx context.Context, endpoint *chat.CryptoEndpoint) (bool, error)
	ActorIdentityPublicKey(ctx context.Context, ptid string) ([]byte, error)
	ActorHomeStationID(ctx context.Context, ptid string) (string, error)
	HomeStationID(ctx context.Context, endpoint *chat.CryptoEndpoint) (string, error)
	ListActiveEndpoints(ctx context.Context, ptid string) ([]*chat.CryptoEndpoint, error)
}

type MlsKeyPackageRepository interface {
	Reserve(
		ctx context.Context,
		planID string,
		endpoint *chat.CryptoEndpoint,
		reservedAt time.Time,
		reservedUntil time.Time,
	) (*chat.ReservedMessagingMlsKeyPackage, error)
	ConsumeReservations(ctx context.Context, planID string) error
	ReleaseReservations(ctx context.Context, planID string) error
}

type AuthorityRepositories struct {
	Authority         AuthorityRepository
	Devices           DeviceDirectory
	Queue             QueueRepository
	Federation        FederationOutboxRepository
	EndpointManifests EndpointManifestRepository
	KeyPackages       MlsKeyPackageRepository
	Plans             AuthorityPlanRepository
}

type AuthorityUnitOfWork interface {
	Execute(ctx context.Context, fn func(AuthorityRepositories) error) error
}
