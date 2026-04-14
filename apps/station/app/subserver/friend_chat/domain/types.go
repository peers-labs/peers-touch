package domain

import "time"

// Attachment references blob storage for a message (e.g. image/file).
type Attachment struct {
	CID          string
	Filename     string
	MimeType     string
	Size         int64
	ThumbnailCID string
}

type Session struct {
	ID              string
	ParticipantADID string
	ParticipantBDID string
	LastMessageID   string
	LastMessageAt   time.Time
	UnreadCountA    int32
	UnreadCountB    int32
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type Message struct {
	ID          string
	SessionID   string
	SenderDID   string
	ReceiverDID string
	Type        int32
	Content     string
	// EncryptedPayload stores E2E ciphertext when the client sends encrypted_payload; otherwise nil.
	EncryptedPayload []byte
	ReplyToID        string
	Status           int32
	Attachments      []Attachment
	SentAt           time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// FriendRequest represents a pending relationship request before chat session creation.
type FriendRequest struct {
	ID          string
	SenderDID   string
	ReceiverDID string
	Status      int32
	Message     string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

const (
	FriendRequestStatusPending  = 1
	FriendRequestStatusAccepted = 2
	FriendRequestStatusRejected = 3
)
