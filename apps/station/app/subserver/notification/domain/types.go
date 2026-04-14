package domain

import "time"

type Notification struct {
	ID          string
	RecipientID string
	ActorID     string
	Type        int32
	Category    int32
	Status      int32
	TargetType  string
	TargetID    string
	Title       string
	Body        string
	Metadata    map[string]string
	GroupKey    string
	CreatedAt   time.Time
	ReadAt      *time.Time
}

type NotificationGroup struct {
	GroupKey   string
	Type      int32
	Category  int32
	TargetType string
	TargetID  string
	Title     string
	Body      string
	Count     int32
	ActorIDs  []string
	Latest    *Notification
	UpdatedAt time.Time
}

type NotificationPreference struct {
	ActorID      string
	Category     int32
	Enabled      bool
	PushEnabled  bool
	SoundEnabled bool
	UpdatedAt    time.Time
}

type UnreadCounts struct {
	Total      int32
	ByCategory map[int32]int32
}

// Category constants matching proto enum values
const (
	CategoryUnspecified = 0
	CategorySocial     = 1
	CategoryChat       = 2
	CategorySystem     = 3
	CategoryTask       = 4
)

// Status constants matching proto enum values
const (
	StatusUnspecified = 0
	StatusUnread      = 1
	StatusRead        = 2
	StatusArchived    = 3
)

// Type constants matching proto enum values
const (
	TypeFriendRequest  = 200
	TypeFriendAccepted = 201
	TypeFriendMessage  = 202
)
