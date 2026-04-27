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

// AckedMessage is the slice of metadata an ack operation needs to fan
// out as a realtime MessageReceipt. The receipt is published to the
// *original sender* (the receiver of the receipt is the SenderDID of
// the message), keyed by the SessionULID. Returned by repo.MarkRead.
//
// We deliberately do not return the post-ack `Status` here — the
// caller already passes the new status into MarkRead and propagates
// the same value to the bus. Carrying it on the slice would invite
// drift between "what we wrote" and "what we announced".
type AckedMessage struct {
	Ulid        string
	SenderDID   string
	SessionULID string
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
