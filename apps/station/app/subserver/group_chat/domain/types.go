package domain

import "time"

// Attachment references blob storage for a group message (e.g. image/file).
type Attachment struct {
	CID          string
	Filename     string
	MimeType     string
	Size         int64
	ThumbnailCID string
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
	GroupID   string
	ActorDID  string
	Role      int32
	Nickname  string
	Muted     bool
	JoinedAt  time.Time
	InvitedBy string
}

type Invitation struct {
	ID         string
	GroupID    string
	InviterDID string
	InviteeDID string
	Status     int32
	CreatedAt  time.Time
}

type GroupSetting struct {
	IsMuted            bool
	IsPinned           bool
	ShowMemberNickname bool
}

type OfflineMessage struct {
	ID         string
	GroupID    string
	MessageID  string
	ReceiverID string
	CreatedAt  time.Time
}
