package domain

import "time"

type StationModerationPolicyKind string

const (
	StationModerationPolicyKindBlock StationModerationPolicyKind = "BLOCK"
)

type StationModerationPolicy struct {
	ID               uint64
	StationDomain    string
	StationPeerID    string
	Kind             StationModerationPolicyKind
	Reason           string
	CreatedByActorID uint64
	CreatedAt        time.Time
	UpdatedAt        time.Time
}
