package domain

import (
	"context"
	"errors"
	"time"
)

var (
	ErrInviteAlreadyConsumed = errors.New("invite already consumed or inactive")
	ErrMountNotFound         = errors.New("mount not found")
	ErrMountCredentialStale  = errors.New("mount credential is stale")
	ErrRelayCapacityFull     = errors.New("relay capacity exceeded")
)

// Repository defines all persistence operations the application layer needs.
// The infrastructure layer provides the concrete implementation.
type Repository interface {
	AutoMigrate() error

	// Invite operations
	CreateInvite(ctx context.Context, invite *Invite) error
	GetInviteBySecretDigest(ctx context.Context, secretDigest string) (*Invite, error)
	ListInvites(ctx context.Context) ([]Invite, error)
	RevokeInvite(ctx context.Context, inviteID uint64) error
	ExpireStaleInvites(ctx context.Context) (int64, error)

	// Mount operations
	ConsumeInviteAndActivateMount(
		ctx context.Context,
		inviteID uint64,
		mount *Mount,
		maxStations int,
	) (*Mount, error)
	GetMountByStationPeerID(ctx context.Context, stationPeerID string) (*Mount, error)
	ActivateMount(ctx context.Context, identity MountIdentity) error
	UpdateMountStatus(
		ctx context.Context,
		stationPeerID string,
		generation uint64,
		status MountStatus,
	) error
	UpdateHeartbeat(
		ctx context.Context,
		stationPeerID string,
		generation uint64,
		credentialJTI string,
	) error
	RotateMountCredential(
		ctx context.Context,
		current MountIdentity,
		nextCredentialJTI string,
	) (*Mount, error)
	RevokeMount(ctx context.Context, stationPeerID string) (*Mount, error)
	ListOnlineMounts(ctx context.Context) ([]Mount, error)
	CountOnlineMounts(ctx context.Context) (int64, error)
	MarkStaleOffline(ctx context.Context, timeout time.Duration) (int64, error)
}
