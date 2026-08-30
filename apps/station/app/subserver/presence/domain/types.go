package domain

import "time"

type State int32

const (
	StateOffline State = 2
	StateOnline  State = 1
)

type Status struct {
	ActorPTID      string
	State          State
	LastSeenAt     time.Time
	LeaseExpiresAt time.Time
}
