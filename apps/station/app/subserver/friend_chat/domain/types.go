package domain

import "time"

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
	ReplyToID   string
	Status      int32
	SentAt      time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
