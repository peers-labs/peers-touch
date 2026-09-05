package domain

import (
	"context"
	"errors"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var (
	ErrFollowerProjectionConflict = errors.New(
		"messaging: follower projection conflicts with persisted state",
	)
	ErrFollowerHeadConflict = errors.New(
		"messaging: follower head compare-and-swap failed",
	)
	ErrFollowerGap = errors.New(
		"messaging: follower projection is waiting for replay",
	)
	ErrFollowerFork = errors.New(
		"messaging: follower projection entered fork-protected read-only state",
	)
	ErrFollowerBufferOverloaded = errors.New(
		"messaging: follower projection buffer capacity exceeded",
	)
	ErrFollowerReplayInvalid = errors.New(
		"messaging: follower replay response is invalid",
	)
	ErrFollowerReplayNotGranted = errors.New(
		"messaging: follower replay is not granted to the requesting Home Station",
	)
	ErrFollowerReplayUnavailable = errors.New(
		"messaging: follower replay source is unavailable",
	)
)

type FollowerConversationState string

const (
	FollowerConversationStateActive                    FollowerConversationState = "ACTIVE"
	FollowerConversationStateGapWaitingResync          FollowerConversationState = "GAP_WAITING_RESYNC"
	FollowerConversationStateForkProtectedReadOnly     FollowerConversationState = "FORK_PROTECTED_READ_ONLY"
	FollowerConversationStateResyncUnavailableReadOnly FollowerConversationState = "RESYNC_UNAVAILABLE_READ_ONLY"
)

type EventProjectionGrant struct {
	ConversationID      string
	EventID             string
	TargetHomeStationID string
	EntitlementReason   string
}

type FollowerConversation struct {
	ConversationID        string
	AuthorityStationID    string
	AuthoritySigningKeyID string
	Kind                  AuthorityConversationKind
	Name                  string
	OwnerPTID             string
	CurrentSequence       int64
	CurrentEventHash      []byte
	MembershipEpoch       int64
	MlsEpoch              int64
	State                 FollowerConversationState
	UpdatedAt             time.Time
}

type FollowerMember struct {
	ConversationID string
	PTID           string
	HomeStationID  string
	Role           string
	Active         bool
	JoinedSequence int64
	LeftSequence   int64
}

type FollowerConversationView struct {
	Conversation *FollowerConversation
	MemberPTIDs  []string
}

type FollowerEventReceipt struct {
	ConversationID string
	Sequence       int64
	EventID        string
	EventHash      []byte
	PreviousHash   []byte
	EventKind      string
	AppliedAt      time.Time
}

type FollowerPendingEvent struct {
	ConversationID   string
	Sequence         int64
	EventID          string
	EventHash        []byte
	PreviousHash     []byte
	PublicEventBytes []byte
	ExpiresAt        time.Time
}

type GrantedFollowerEvent struct {
	Event *chat.ConversationEvent
	Grant EventProjectionGrant
}

type EventProjectionGrantRepository interface {
	AppendEventProjectionGrants(
		ctx context.Context,
		grants []EventProjectionGrant,
	) error
	ListEventProjectionGrants(
		ctx context.Context,
		conversationID string,
		eventID string,
	) ([]EventProjectionGrant, error)
}

// FollowerRepository exposes durable primitives only. Projection validation,
// ordering, replay, and membership application remain application-layer work.
type FollowerRepository interface {
	CreateConversation(
		ctx context.Context,
		conversation *FollowerConversation,
	) (bool, error)
	GetConversation(
		ctx context.Context,
		conversationID string,
	) (*FollowerConversation, error)
	AdvanceConversationHead(
		ctx context.Context,
		expectedSequence int64,
		expectedEventHash []byte,
		next *FollowerConversation,
	) error
	UpsertMember(ctx context.Context, member *FollowerMember) error
	ListMembers(ctx context.Context, conversationID string) ([]FollowerMember, error)
	AppendEventReceipt(ctx context.Context, receipt *FollowerEventReceipt) error
	GetEventReceipt(
		ctx context.Context,
		conversationID string,
		sequence int64,
	) (*FollowerEventReceipt, error)
	GetEventReceiptByEventID(
		ctx context.Context,
		conversationID string,
		eventID string,
	) (*FollowerEventReceipt, error)
	StorePendingEvent(ctx context.Context, event *FollowerPendingEvent) error
	ListPendingEvents(
		ctx context.Context,
		conversationID string,
	) ([]FollowerPendingEvent, error)
	DeletePendingEvent(ctx context.Context, conversationID string, sequence int64) error
	DeleteExpiredPendingEvents(
		ctx context.Context,
		conversationID string,
		expiresAtOrBefore time.Time,
	) (int64, error)
	UpdateConversationState(
		ctx context.Context,
		conversationID string,
		state FollowerConversationState,
		updatedAt time.Time,
	) error
	ListConversationsByState(
		ctx context.Context,
		state FollowerConversationState,
	) ([]FollowerConversation, error)
	ListActiveConversationsForActor(
		ctx context.Context,
		ptid string,
		localStationID string,
	) ([]FollowerConversationView, error)
}

type FollowerReplaySource interface {
	ReadGrantedFollowerEvents(
		ctx context.Context,
		request *chat.GetMessagingFollowerEventsRequest,
	) ([]GrantedFollowerEvent, int64, bool, error)
}

type FollowerReplayPageSigner interface {
	SignFollowerEventsPage(
		ctx context.Context,
		request *chat.GetMessagingFollowerEventsRequest,
		page *chat.MessagingFollowerEventsPage,
	) error
}

type FollowerReplayClient interface {
	FetchFollowerEvents(
		ctx context.Context,
		authorityStationID string,
		expectedSigningKeyID string,
		request *chat.GetMessagingFollowerEventsRequest,
	) (*chat.MessagingFollowerEventsPage, error)
}
