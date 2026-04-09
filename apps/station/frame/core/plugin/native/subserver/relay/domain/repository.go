package domain

import (
	"context"
	"time"
)

// Repository defines all persistence operations the application layer needs.
// The infrastructure layer provides the concrete implementation.
type Repository interface {
	AutoMigrate() error

	// Invite operations
	CreateInvite(ctx context.Context, invite *Invite) error
	GetInviteByToken(ctx context.Context, token string) (*Invite, error)
	ConsumeInvite(ctx context.Context, inviteID uint64, stationPeerID string) error
	ListInvites(ctx context.Context) ([]Invite, error)
	RevokeInvite(ctx context.Context, inviteID uint64) error
	ExpireStaleInvites(ctx context.Context) (int64, error)

	// Mount operations
	CreateMount(ctx context.Context, mount *Mount) error
	GetMountByStationPeerID(ctx context.Context, stationPeerID string) (*Mount, error)
	UpdateMountStatus(ctx context.Context, stationPeerID string, status MountStatus) error
	UpdateHeartbeat(ctx context.Context, stationPeerID string) error
	ListOnlineMounts(ctx context.Context) ([]Mount, error)
	CountOnlineMounts(ctx context.Context) (int64, error)
	MarkStaleOffline(ctx context.Context, timeout time.Duration) (int64, error)
	DeleteMount(ctx context.Context, stationPeerID string) error
}
