package domain

import "time"

// Attachment references blob storage for a message (e.g. image/file).
//
// Visibility echoes the OSS-side `oss_files.visibility` for the
// attachment's primary `CID` ("public" / "chat" / "private"). The
// sender is authoritative — the server stores it verbatim and the
// receiver renders a badge so the recipient can tell at a glance
// whether the file is reach-restricted to this chat session or has
// been published to a wider audience. An empty string means the
// sender did not declare a scope (legacy clients) and the UI MUST
// render no badge in that case.
type Attachment struct {
	CID          string
	Filename     string
	MimeType     string
	Size         int64
	ThumbnailCID string
	Visibility   string
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
	// Recalled flips when the original sender invokes recall. The
	// row is kept (so threading and search snippets stay coherent)
	// but Content / EncryptedPayload are cleared and clients render
	// a tombstone in place of the bubble. Mutually exclusive with
	// the row even existing: a deleted message has no row at all.
	Recalled bool
	// EditedAt is the wall-clock at which the row's content was last
	// replaced via edit. Zero-value when never edited. Display-only;
	// clients must not use it for ordering.
	EditedAt time.Time
	SentAt   time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

// MutationOutcome is the slice of metadata a recall / edit / delete
// operation needs to publish a realtime MessageMutation event. The
// repo layer fills it from the DB row that was actually mutated, so
// the handler never has to second-guess "did the row exist? was the
// caller the owner?" before fanning out.
//
// `NewContent` / `NewCiphertext` are populated on EDIT only; on
// RECALL and DELETE both are zero-value. `Kind` mirrors the
// realtime MessageMutation_Kind enum on the wire (RECALL=1, EDIT=2,
// DELETE=3).
type MutationOutcome struct {
	Ulid          string
	SessionULID   string
	SenderDID     string
	ReceiverDID   string
	Kind          int32
	NewContent    string
	NewCiphertext []byte
	MutatedAt     time.Time
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
