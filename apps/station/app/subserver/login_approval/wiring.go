package login_approval

import (
	"context"

	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	accessgate "github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	"gorm.io/gorm"
)

// CountEnrolledDevices returns the number of non-revoked devices enrolled for
// an Actor. It is a pure query so the exclusion rule is unit-testable without
// booting the global RDS store.
func CountEnrolledDevices(database *gorm.DB, actorPtid string) (int, error) {
	var count int64
	err := database.
		Model(&identitydb.ActorDeviceModel{}).
		Where("ptid = ? AND revoked = ?", actorPtid, false).
		Count(&count).Error
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

// enrolledDeviceCount adapts the pure query to the frame gatekeeper seam,
// resolving the request-scoped RDS handle at call time.
func enrolledDeviceCount(ctx context.Context, actorPtid string) (int, error) {
	database, err := store.GetRDS(ctx)
	if err != nil {
		return 0, err
	}
	return CountEnrolledDevices(database, actorPtid)
}

// ConfigureFrameGate installs the app-owned enrollment counter into the frame
// access-gate seam. The enabled flag is read from the persisted Access policy,
// which defaults to false, so wiring the counter alone cannot change any
// authorization decision.
func ConfigureFrameGate() {
	accessgate.ConfigureDeviceApproval(enrolledDeviceCount)
}
