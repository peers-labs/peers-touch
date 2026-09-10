package repository

import (
	"bytes"
	"context"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type AuthorityRepository interface {
	Create(ctx context.Context, snapshot aggregate.Snapshot) error
	LoadForUpdate(
		ctx context.Context,
		conversationID valueobject.ConversationID,
	) (aggregate.Snapshot, error)
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
	) (aggregate.Snapshot, error)
	ListByActor(ctx context.Context, actor valueobject.PTID) ([]aggregate.Snapshot, error)
	Save(ctx context.Context, snapshot aggregate.Snapshot) error
}

type EventRepository interface {
	Append(ctx context.Context, event domainevent.Record) error
	GetByID(ctx context.Context, eventID valueobject.EventID) (domainevent.Record, error)
	GetByCommand(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		commandID valueobject.CommandID,
	) (domainevent.Record, error)
	GetBySequence(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		sequence valueobject.Sequence,
	) (domainevent.Record, error)
	GetMessageIdentity(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		messageID valueobject.MessageID,
	) (MessageIdentity, error)
	List(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		after valueobject.Sequence,
		limit int,
	) ([]domainevent.Record, error)
	ListMessages(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		after valueobject.Sequence,
		limit int,
	) ([]domainevent.Record, error)
	ListThreadMessages(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		threadRootID valueobject.MessageID,
		after valueobject.Sequence,
		limit int,
	) ([]domainevent.Record, error)
	ThreadCounts(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		rootIDs []valueobject.MessageID,
	) ([]ThreadCount, error)
}

type MessageIdentity struct {
	ConversationID valueobject.ConversationID
	MessageID      valueobject.MessageID
	Author         valueobject.PTID
	EventID        valueobject.EventID
	Sequence       valueobject.Sequence
}

type ThreadCount struct {
	RootMessageID valueobject.MessageID
	ReplyCount    int64
	LatestReplyID valueobject.MessageID
	LatestReplyAt time.Time
}

type CommandReceiptOutcome string

const (
	CommandReceiptOutcomeAccepted CommandReceiptOutcome = "accepted"
	CommandReceiptOutcomeRejected CommandReceiptOutcome = "rejected"
)

type CommandReceipt struct {
	ConversationID valueobject.ConversationID
	CommandID      valueobject.CommandID
	CommandHash    valueobject.Hash
	Outcome        CommandReceiptOutcome
	EventID        valueobject.EventID
	EventBytes     []byte
	RejectionCode  conversationdomain.ErrorCode
	CreatedAt      time.Time
}

type CommandReceiptRepository interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		commandID valueobject.CommandID,
	) (CommandReceipt, error)
	Create(ctx context.Context, receipt CommandReceipt) error
}

type AuthorityPlanRepository interface {
	Create(ctx context.Context, plan entity.AuthorityPlan) error
	LoadForUpdate(ctx context.Context, planID valueobject.PlanID) (entity.AuthorityPlan, error)
	Save(ctx context.Context, plan entity.AuthorityPlan) error
}

type MemberSettings struct {
	ConversationID      valueobject.ConversationID
	Actor               valueobject.PTID
	Nickname            string
	Muted               bool
	Pinned              bool
	AlertEnabled        bool
	Background          string
	BackgroundImage     string
	ClearedAtUnixMillis int64
	UpdatedAt           time.Time
}

type MemberSettingsRepository interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (MemberSettings, error)
	Save(ctx context.Context, settings MemberSettings) error
}

type ReadCursor struct {
	ConversationID valueobject.ConversationID
	Actor          valueobject.PTID
	Sequence       valueobject.Sequence
	UpdatedAt      time.Time
}

type ReadCursorRepository interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (ReadCursor, error)
	Advance(ctx context.Context, cursor ReadCursor) (ReadCursor, bool, error)
}

type LeaveIntentState string

const (
	LeaveIntentStatePending  LeaveIntentState = "pending"
	LeaveIntentStateConsumed LeaveIntentState = "consumed"
	LeaveIntentStateExpired  LeaveIntentState = "expired"
)

type LeaveIntent struct {
	Version          uint32
	ID               string
	FederationID     valueobject.FederationID
	ConversationID   valueobject.ConversationID
	Actor            valueobject.Endpoint
	SigningKeyID     string
	AuthorityEpoch   valueobject.AuthorityEpoch
	AuthorityHead    valueobject.AuthorityHead
	SigningBytes     []byte
	Signature        []byte
	State            LeaveIntentState
	CreatedAt        time.Time
	ExpiresAt        time.Time
	ConsumedAt       *time.Time
	TransitionID     valueobject.TransitionID
	HomeStation      valueobject.StationID
	AuthorityStation valueobject.StationID
}

func (l LeaveIntent) SameIdentity(other LeaveIntent) bool {
	return l.Version == other.Version &&
		l.ID == other.ID &&
		l.FederationID == other.FederationID &&
		l.ConversationID == other.ConversationID &&
		l.Actor == other.Actor &&
		l.SigningKeyID == other.SigningKeyID &&
		l.AuthorityEpoch == other.AuthorityEpoch &&
		l.AuthorityHead == other.AuthorityHead &&
		l.HomeStation == other.HomeStation &&
		l.AuthorityStation == other.AuthorityStation &&
		l.CreatedAt.Equal(other.CreatedAt) &&
		l.ExpiresAt.Equal(other.ExpiresAt) &&
		bytes.Equal(l.SigningBytes, other.SigningBytes) &&
		bytes.Equal(l.Signature, other.Signature)
}

type LeaveIntentRepository interface {
	Create(ctx context.Context, intent LeaveIntent) (LeaveIntent, error)
	LoadForUpdate(ctx context.Context, intentID string) (LeaveIntent, error)
	Save(ctx context.Context, intent LeaveIntent) error
	ListPending(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
		limit int,
	) ([]LeaveIntent, error)
}

type FollowerStatus string

const (
	FollowerStatusActive         FollowerStatus = "active"
	FollowerStatusResyncRequired FollowerStatus = "resync_required"
	FollowerStatusDegraded       FollowerStatus = "degraded"
	FollowerStatusReadOnly       FollowerStatus = "read_only"
)

type FollowerProjection struct {
	Conversation aggregate.Snapshot
	Head         valueobject.AuthorityHead
	Status       FollowerStatus
	UpdatedAt    time.Time
}

type FollowerRepository interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
	) (FollowerProjection, error)
	ListByActor(ctx context.Context, actor valueobject.PTID) ([]FollowerProjection, error)
	ListByStatus(
		ctx context.Context,
		status FollowerStatus,
		limit int,
	) ([]FollowerProjection, error)
	Apply(ctx context.Context, projection FollowerProjection, event domainevent.Record) error
	Buffer(ctx context.Context, event domainevent.Record) error
	GetBuffered(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		sequence valueobject.Sequence,
	) (domainevent.Record, error)
	NextBuffered(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		after valueobject.Sequence,
	) (domainevent.Record, error)
	DeleteBuffered(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		sequence valueobject.Sequence,
	) error
	SetStatus(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		status FollowerStatus,
	) error
	Status(
		ctx context.Context,
		conversationID valueobject.ConversationID,
	) (FollowerStatus, error)
}

type Repositories struct {
	Authority      AuthorityRepository
	Events         EventRepository
	Receipts       CommandReceiptRepository
	AuthorityPlans AuthorityPlanRepository
	MemberSettings MemberSettingsRepository
	ReadCursors    ReadCursorRepository
	LeaveIntents   LeaveIntentRepository
	Followers      FollowerRepository
}
