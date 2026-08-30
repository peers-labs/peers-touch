package domain

import "time"

type FriendRequest struct {
	ID           string
	SenderPtid   string
	ReceiverPtid string
	Status       int32
	Message      string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

const (
	FriendRequestStatusPending  int32 = 1
	FriendRequestStatusAccepted int32 = 2
	FriendRequestStatusRejected int32 = 3
)
