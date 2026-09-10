package repository

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
)

// DeviceRepository owns the actor_devices lifecycle transaction boundary.
type DeviceRepository interface {
	Enroll(
		ctx context.Context,
		enrollment domain.Enrollment,
		enrolledAt time.Time,
	) (domain.Device, error)
	List(ctx context.Context, ptid string) ([]domain.Device, error)
	Revoke(
		ctx context.Context,
		ptid string,
		deviceID string,
		observedProfileVersion uint64,
		revokedAt time.Time,
	) (domain.Device, error)
}
