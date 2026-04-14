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
	SentAt           time.Time
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
