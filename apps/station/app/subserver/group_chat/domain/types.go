package domain

import "time"

const (
	GroupRoleMember int32 = 1
	GroupRoleAdmin  int32 = 2
	GroupRoleOwner  int32 = 3
)

const (
	GroupStatusActive    = "active"
	GroupStatusDissolved = "dissolved"
)

// Attachment references blob storage for a group message (e.g. image/file).
//
// Visibility echoes the OSS-side `oss_files.visibility` for the
// attachment's primary `CID` ("public" / "chat" / "private"). Sender-
// authoritative; the server stores it verbatim. The receiver uses
// the value to render a scope badge so the recipient can tell
// whether the file is reach-restricted to this group or has been
// published more broadly. Empty string means "not declared" (legacy)
// and the UI MUST render no badge in that case.
type Attachment struct {
	CID          string
	Filename     string
	MimeType     string
	Size         int64
	ThumbnailCID string
	Visibility   string
}

type Group struct {
	ID              string
	Name            string
	Description     string
	OwnerDID        string
	MemberCount     int32
	Status          string
	DissolvedAt     time.Time
	MembershipEpoch int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type FederatedActorRef struct {
	ActorDID               string
	HomeStationPeerID      string
	HomeStationDomain      string
	FederatedHandle        string
	ActorIdentityPublicKey []byte
	ProfileVersion         int64
	FederationID           string
}

type GroupProposal struct {
	ProposalULID            string
	GroupID                 string
	Actor                   FederatedActorRef
	Command                 int32
	CommandPayload          []byte
	ObservedMembershipEpoch int64
	AuthorityStationPeerID  string
	AuthorityEpoch          int64
	IdempotencyKey          string
	SigningKeyID            string
	Signature               []byte
	CreatedAt               time.Time
}

type GroupProposalOutboxItem struct {
	ProposalULID            string
	GroupID                 string
	Proposal                GroupProposal
	Actor                   FederatedActorRef
	Command                 int32
	AuthorityStationPeerID  string
	AuthorityEpoch          int64
	ObservedMembershipEpoch int64
	IdempotencyKey          string
	Status                  string
	AttemptCount            int
	NextAttemptAt           time.Time
	LastError               string
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type GroupEvent struct {
	EventULID              string
	GroupID                string
	Seq                    int64
	PrevHash               string
	EventHash              string
	EventType              string
	Actor                  FederatedActorRef
	MessageID              string
	MembershipEpoch        int64
	AuthorityStationPeerID string
	AuthorityEpoch         int64
	ProposalULID           string
	IdempotencyKey         string
	EventPayload           []byte
	CreatedAt              time.Time
}

type FollowerProjection struct {
	GroupID                string
	AuthorityStationPeerID string
	AuthorityEpoch         int64
	LastSeq                int64
	LastEventHash          string
	Status                 string
	ProtectionReason       string
}

type GroupSkdmEnvelope struct {
	OutboxULID                 string
	GroupID                    string
	MembershipEpoch            int64
	SenderDID                  string
	SenderKeyID                uint32
	RecipientDID               string
	RecipientDeviceID          string
	RecipientHomeStationPeerID string
	EncryptedPayload           []byte
	IdempotencyKey             string
	Status                     string
	AttemptCount               int
	NextAttemptAt              time.Time
	LastError                  string
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
}

type FederationOutboxItem struct {
	EventULID              string
	GroupID                string
	Seq                    int64
	TargetStationPeerID    string
	AuthorityStationPeerID string
	AuthorityEpoch         int64
	Status                 string
	AttemptCount           int
	NextAttemptAt          time.Time
	LastError              string
	Event                  GroupEvent
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

type Message struct {
	ID               string
	GroupID          string
	SenderDID        string
	Type             int32
	Content          string
	ReplyToID        string
	ThreadRootID     string
	MentionedDIDs    []string
	MentionAll       bool
	Attachments      []Attachment
	EncryptedPayload []byte
	// Recalled mirrors messageModel.Recalled. See the model
	// doc-comment for the column-name caveat.
	Recalled bool
	// EditedAt is non-zero when the message body was replaced
	// via edit. Display-only; readers must not use it for
	// ordering. Mirrors FriendChat.Message.EditedAt.
	EditedAt time.Time
	SentAt   time.Time
}

type ThreadCount struct {
	RootULID        string
	ReplyCount      int64
	LatestReplyULID string
	LatestReplyAt   time.Time
	UnreadCount     int64
}

// MutationOutcome bundles the metadata that the application layer
// returns after a successful recall / edit / delete. The handler
// uses it to publish a `realtime.MessageMutation` event onto the
// recipients' SSE stream so peers converge without polling.
//
// Mirrors friend_chat/domain.MutationOutcome but carries the group
// recipient list (every member except the originator) instead of a
// single receiver_did.
type MutationOutcome struct {
	Ulid          string
	GroupID       string
	SenderDID     string
	RecipientDIDs []string
	Kind          int32
	NewContent    string
	NewCiphertext []byte
	MutatedAt     time.Time
}

type Member struct {
	GroupID    string
	ActorDID   string
	Actor      FederatedActorRef
	Role       int32
	Nickname   string
	Muted      bool
	MutedUntil time.Time
	JoinedAt   time.Time
	InvitedBy  string
}

type Invitation struct {
	ID         string
	GroupID    string
	InviterDID string
	InviteeDID string
	Status     int32
	ExpireAt   time.Time
	CreatedAt  time.Time
}

type GroupSetting struct {
	IsMuted            bool
	IsPinned           bool
	ShowMemberNickname bool
	AlertEnabled       bool
	Background         string
	ClearedAtUnixMs    int64
}

type OfflineMessage struct {
	ID         string
	GroupID    string
	MessageID  string
	ReceiverID string
	CreatedAt  time.Time
}
