package domain

import (
	"context"
	"errors"
	"time"
)

var (
	ErrInviteAlreadyConsumed = errors.New("invite already consumed or inactive")
	ErrEnrollmentNotFound    = errors.New("enrollment not found")
	ErrNodeCredentialStale   = errors.New("enrollment credential is stale")
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

	// Enrollment operations
	ConsumeInviteAndCreateEnrollment(
		ctx context.Context,
		inviteID uint64,
		enrollment *Enrollment,
		maxStations int,
	) (*Enrollment, error)
	GetEnrollmentByStationPeerID(ctx context.Context, stationPeerID string) (*Enrollment, error)
	UpdateEnrollmentStatus(
		ctx context.Context,
		stationPeerID string,
		generation uint64,
		status EnrollmentStatus,
	) error
	RotateNodeCredential(
		ctx context.Context,
		current NodeIdentity,
		nextCredentialJTI string,
	) (*Enrollment, error)
	UpdateNodeAuthorization(
		ctx context.Context,
		current NodeIdentity,
		nodeAuthorizationEpoch uint64,
		nodeAuthorizationUntil time.Time,
	) error
	RevokeEnrollment(ctx context.Context, stationPeerID string) (*Enrollment, error)
	ListAdmittedEnrollments(ctx context.Context) ([]Enrollment, error)
	ListOnlineEnrollments(ctx context.Context) ([]Enrollment, error)
	CountOnlineEnrollments(ctx context.Context) (int64, error)
}
