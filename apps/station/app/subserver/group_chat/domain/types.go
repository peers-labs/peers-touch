package domain

import "time"

const (
	GroupRoleMember int32 = 1
	GroupRoleAdmin  int32 = 2
	GroupRoleOwner  int32 = 3
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
	ID          string
	Name        string
	Description string
	OwnerDID    string
	MemberCount int32
	CreatedAt   time.Time
	UpdatedAt   time.Time
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
