package ports

import (
	"context"
	"time"
)

type ActorDeviceAuthorizer interface {
	// Actor authorization supports fresh-install restore before a replacement
	// device becomes active; storing still requires an active actor-bound device.
	IsActorAuthorizedForRecovery(ctx context.Context, ptid string) (bool, error)
	IsDeviceAuthorizedForRecovery(
		ctx context.Context,
		ptid string,
		deviceID string,
	) (bool, error)
}

type Clock interface {
	Now() time.Time
}
