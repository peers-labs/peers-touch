package conversation

import (
	"context"
	"time"

	envpkg "github.com/peers-labs/peers-touch/station/app/subserver/envelope"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// Service is the application-layer interface for the conversation domain.
type Service interface {
	// CreateDirect establishes a deterministic direct conversation between two actors.
	// The conversation ID is deterministic per DP-4 (sorted PTID pair).
	// Idempotent: returns existing conversation if already created.
	CreateDirect(ctx context.Context, actorA, actorB string, actorAStation, actorBStation string) (*chat.Conversation, error)

	// CreateGroup creates the group and commits its epoch-1 MLS genesis
	// transition atomically. This Station becomes the authority.
	CreateGroup(
		ctx context.Context,
		name string,
		ownerPtid string,
		ownerStation string,
		ownerDeviceID string,
		federationID string,
		conversationID string,
		genesis *chat.MembershipTransitionCommand,
	) (*chat.Conversation, *chat.CommittedConversationEvent, error)

	// SubmitCommand validates and processes a ConversationCommand.
	// For direct chats where this Station is authority: commits immediately.
	// For federated conversations: proposes to the authority Station.
	SubmitCommand(ctx context.Context, cmd *chat.ConversationCommand) (*chat.CommittedConversationEvent, error)

	// SubmitReceipt processes a message receipt (delivered/read) and routes it
	// to the message sender via envelope.
	SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt) error

	// GetConversation returns a conversation by ID.
	GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error)

	// ListConversations returns all conversations for an actor.
	ListConversations(ctx context.Context, ptid string) ([]*chat.Conversation, error)

	// GetMembers returns members for a conversation.
	GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error)

	// GetMember returns a single member by conversation and ptid.
	GetMember(ctx context.Context, conversationID, ptid string) (*chat.ConversationMember, error)

	// UpsertMember creates or updates a conversation member record.
	UpsertMember(ctx context.Context, member *chat.ConversationMember) error

	// ListEvents returns committed events for a conversation after a given sequence number.
	ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

	// ListMessages returns only message-committed events (excludes admin/system events).
	ListMessages(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

	// ListThreadMessages returns message events for a specific thread.
	ListThreadMessages(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)
}

// Repository is the persistence contract for the conversation domain.
type Repository interface {
	// UpsertConversation creates or updates a conversation.
	UpsertConversation(ctx context.Context, conv *chat.Conversation) error

	// GetConversation retrieves a conversation by ID.
	GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error)

	// GetConversationForUpdate retrieves and locks the authority head for a
	// membership transition. Callers must invoke it inside TransitionUnitOfWork.
	GetConversationForUpdate(ctx context.Context, conversationID string) (*chat.Conversation, error)

	// ListByActor returns all conversations where the actor is an active member.
	ListByActor(ctx context.Context, ptid string) ([]*chat.Conversation, error)

	// UpsertMember creates or updates a conversation member.
	UpsertMember(ctx context.Context, member *chat.ConversationMember) error

	// UpsertMemberDevice records whether a device participates in the
	// conversation MLS tree.
	UpsertMemberDevice(ctx context.Context, conversationID, ptid, deviceID, homeStationPeerID string, active bool) error

	// ListMemberDevices returns the device-level MLS participants for a group.
	ListMemberDevices(ctx context.Context, conversationID string, activeOnly bool) ([]MemberDevice, error)

	// GetMembers returns all members for a conversation.
	GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error)

	// GetMember returns a specific member.
	GetMember(ctx context.Context, conversationID, ptid string) (*chat.ConversationMember, error)

	// AppendEvent persists a committed event and updates group_seq.
	AppendEvent(ctx context.Context, event *chat.CommittedConversationEvent) error

	// ListEvents returns events for a conversation after a given seq.
	ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

	// GetEventByTransitionID returns an already committed transition for
	// idempotent replay handling.
	GetEventByTransitionID(ctx context.Context, conversationID, transitionID string) (*chat.CommittedConversationEvent, error)

	// GetLastEvent returns the current authority event head.
	GetLastEvent(ctx context.Context, conversationID string) (*chat.CommittedConversationEvent, error)

	// GetCommandReceipt returns the canonical result for one durable command.
	GetCommandReceipt(ctx context.Context, conversationID, commandID string) (*CommandReceipt, error)

	// CreateCommandReceipt records the command hash and canonical event bytes.
	CreateCommandReceipt(ctx context.Context, receipt *CommandReceipt) error

	// NextSeq atomically increments and returns the next group_seq.
	NextSeq(ctx context.Context, conversationID string) (int64, error)

	// BumpMembershipEpoch atomically sets the membership_epoch for a conversation.
	// This binds the MLS epoch to the authority-sequenced membership change (C-4).
	BumpMembershipEpoch(ctx context.Context, conversationID string, newEpoch int64) error

	// SetMembershipAndMlsEpoch advances the business and declared MLS heads in
	// the same transaction.
	SetMembershipAndMlsEpoch(ctx context.Context, conversationID string, membershipEpoch, mlsEpoch int64) error

	// HaveSharedConversation returns true if actorA and actorB are both active
	// members of at least one common conversation. Used by the social gate for
	// relationship-based access control.
	HaveSharedConversation(ctx context.Context, actorA, actorB string) (bool, error)

	// ListThreadEvents returns events belonging to a specific thread (by root message ID).
	// Uses partial index on thread_root_message_id for O(log n) lookup.
	ListThreadEvents(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)
}

// TransitionRepositories are transaction-scoped adapters over one Station DB
// transaction. Envelope persistence remains owned by the envelope repository.
type TransitionRepositories struct {
	Conversation Repository
	Envelope     envpkg.Repository
	LeaveIntents LeaveIntentRepository
}

// TransitionUnitOfWork atomically coordinates conversation truth and envelope
// outbox/inbox facts.
type TransitionUnitOfWork interface {
	Execute(ctx context.Context, fn func(TransitionRepositories) error) error
}

// MemberDevice is the Station-owned routing projection for one MLS device.
type MemberDevice struct {
	Ptid              string
	DeviceID          string
	HomeStationPeerID string
	Active            bool
}

// CommandReceipt binds a command identity and hash to its canonical event.
type CommandReceipt struct {
	ConversationID string
	CommandID      string
	CommandSHA256  []byte
	EventBytes     []byte
	CreatedAt      time.Time
}

// EnvelopeSubmitter routes committed events to recipients via the envelope service.
type EnvelopeSubmitter interface {
	// SubmitEvent wraps a committed event in an envelope and submits it
	// to each recipient member through the envelope service.
	SubmitEvent(ctx context.Context, conv *chat.Conversation, members []*chat.ConversationMember, event *chat.CommittedConversationEvent) error

	// SubmitReceipt routes a message receipt to the message sender.
	SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt, recipientPtid, recipientStation string) error
}

// PersistedEnvelopeNotifier wakes connected local devices after transaction commit.
type PersistedEnvelopeNotifier interface {
	NotifyPersisted(ctx context.Context, item *chat.DeviceInboxItem)
}

// DirectConversationIDFunc generates a deterministic conversation ID for a direct pair.
type DirectConversationIDFunc func(actorA, actorB string) string

// Clock abstracts time for testability.
type Clock func() time.Time
