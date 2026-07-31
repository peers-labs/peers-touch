package conversation

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// Service is the application-layer interface for the conversation domain.
type Service interface {
	// CreateDirect establishes a deterministic direct conversation between two actors.
	// The conversation ID is deterministic per DP-4 (sorted DID pair).
	// Idempotent: returns existing conversation if already created.
	CreateDirect(ctx context.Context, actorA, actorB string, actorAStation, actorBStation string) (*chat.Conversation, error)

	// CreateGroup creates a new group conversation. This Station becomes the authority.
	// The membership_epoch starts at 1.
	CreateGroup(ctx context.Context, name string, ownerPtid string, ownerStation string, members []MemberEntry) (*chat.Conversation, error)

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

	// GetThreadCounts returns reply count summaries for multiple thread roots.
	GetThreadCounts(ctx context.Context, conversationID string, rootIDs []string) (map[string]ThreadSummary, error)

	// SetReadCursor updates the read position for an actor.
	SetReadCursor(ctx context.Context, conversationID, ptid string, seq int64) error

	// GetUnreadCount returns unread message count for an actor.
	GetUnreadCount(ctx context.Context, conversationID, ptid string) (int64, error)
}

// MemberEntry is used when creating a group to specify initial members.
type MemberEntry struct {
	Ptid      string
	StationID string
	Role      chat.MemberRole
}

// Repository is the persistence contract for the conversation domain.
type Repository interface {
	// UpsertConversation creates or updates a conversation.
	UpsertConversation(ctx context.Context, conv *chat.Conversation) error

	// GetConversation retrieves a conversation by ID.
	GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error)

	// ListByActor returns all conversations where the actor is an active member.
	ListByActor(ctx context.Context, ptid string) ([]*chat.Conversation, error)

	// UpsertMember creates or updates a conversation member.
	UpsertMember(ctx context.Context, member *chat.ConversationMember) error

	// GetMembers returns all members for a conversation.
	GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error)

	// GetMember returns a specific member.
	GetMember(ctx context.Context, conversationID, ptid string) (*chat.ConversationMember, error)

	// AppendEvent persists a committed event and updates group_seq.
	AppendEvent(ctx context.Context, event *chat.CommittedConversationEvent) error

	// ListEvents returns events for a conversation after a given seq.
	ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

	// NextSeq atomically increments and returns the next group_seq.
	NextSeq(ctx context.Context, conversationID string) (int64, error)

	// BumpMembershipEpoch atomically sets the membership_epoch for a conversation.
	// This binds the MLS epoch to the authority-sequenced membership change (C-4).
	BumpMembershipEpoch(ctx context.Context, conversationID string, newEpoch int64) error

	// HaveSharedConversation returns true if actorA and actorB are both active
	// members of at least one common conversation. Used by the social gate for
	// relationship-based access control.
	HaveSharedConversation(ctx context.Context, actorA, actorB string) (bool, error)

	// ListThreadEvents returns events belonging to a specific thread (by root message ID).
	// Uses partial index on thread_root_message_id for O(log n) lookup.
	ListThreadEvents(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

	// CountThreadReplies returns reply counts for multiple thread roots in one query.
	CountThreadReplies(ctx context.Context, conversationID string, rootIDs []string) (map[string]ThreadSummary, error)

	// GetReadCursor returns the last-read event seq for an actor in a conversation.
	GetReadCursor(ctx context.Context, conversationID, ptid string) (int64, error)

	// SetReadCursor upserts the read position for an actor.
	SetReadCursor(ctx context.Context, conversationID, ptid string, seq int64) error

	// CountUnread returns the number of message events after the actor's read cursor.
	CountUnread(ctx context.Context, conversationID, ptid string) (int64, error)
}

// ThreadSummary holds denormalized thread counters per root message.
type ThreadSummary struct {
	RootMessageID   string
	ReplyCount      int64
	LatestReplyID   string
	LatestReplyAtMs int64
}

// EnvelopeSubmitter routes committed events to recipients via the envelope service.
type EnvelopeSubmitter interface {
	// SubmitEvent wraps a committed event in an envelope and submits it
	// to each recipient member through the envelope service.
	SubmitEvent(ctx context.Context, conv *chat.Conversation, members []*chat.ConversationMember, event *chat.CommittedConversationEvent) error

	// SubmitReceipt routes a message receipt to the message sender.
	SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt, recipientPtid, recipientStation string) error
}

// DirectConversationIDFunc generates a deterministic conversation ID for a direct pair.
type DirectConversationIDFunc func(actorA, actorB string) string

// Clock abstracts time for testability.
type Clock func() time.Time
