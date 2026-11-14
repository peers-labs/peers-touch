package infrastructure_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure"
	linkdb "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	ptid      = "ptid:v1:actor:peers:p:alice:test"
	stationID = "station-test"
)

func openDB(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, database.AutoMigrate(&db.Actor{}, &db.AccessAttempt{}))
	require.NoError(t, session.NewDBStore(func(context.Context) (*gorm.DB, error) {
		return database, nil
	}, 0).AutoMigrate(context.Background()))
	require.NoError(t, linkdb.Migrate(database))
	require.NoError(t, database.AutoMigrate(&identitydb.ActorDeviceModel{}))
	return database
}

func seedActorAndDevice(t *testing.T, database *gorm.DB, deviceID string, revoked bool) {
	t.Helper()
	now := time.Now().UTC()
	require.NoError(t, database.Create(&db.Actor{ID: 7, PTID: ptid, PreferredUsername: "alice",
		HomeStationPeerID: stationID}).Error)
	require.NoError(t, database.Create(&identitydb.ActorDeviceModel{PTID: ptid, ActorAccount: "alice",
		DeviceID: deviceID, Label: deviceID, HomeStationPeerID: stationID, SigningKeyID: "key",
		PublicKey: make([]byte, 32), ProfileVersion: 1, Revoked: revoked, CreatedAt: now}).Error)
}

func TestAccessDeviceApprovalJourney_AttemptResolution(t *testing.T) {
	database := openDB(t)
	seedActorAndDevice(t, database, "existing-phone", false)
	now := time.Now().UTC()
	require.NoError(t, database.Create(&db.AccessAttempt{ID: "attempt-ok", Status: "action_required",
		StationPeerID: stationID, ActorPTID: ptid, DeviceID: "new-phone", DecisionRevision: 3,
		CreatedAt: now, ExpiresAt: now.Add(time.Hour)}).Error)

	binding, err := infrastructure.AttemptOwner{}.ResolveCredentialAttempt(context.Background(),
		database, "attempt-ok", 3, "new-phone")
	require.NoError(t, err)
	require.Equal(t, uint64(7), binding.UserID)
	require.Equal(t, 1, binding.EnrolledDeviceCount)
	require.Equal(t, ptid, binding.ActorPTID)

	// An attempt without a bound Actor has not passed the credential gate.
	require.NoError(t, database.Create(&db.AccessAttempt{ID: "attempt-anon", Status: "action_required",
		StationPeerID: stationID, DeviceID: "new-phone", DecisionRevision: 1,
		CreatedAt: now, ExpiresAt: now.Add(time.Hour)}).Error)
	_, err = infrastructure.AttemptOwner{}.ResolveCredentialAttempt(context.Background(),
		database, "attempt-anon", 1, "new-phone")
	require.Error(t, err)
}

func TestAccessDeviceApprovalJourney_ApproverValidation(t *testing.T) {
	database := openDB(t)
	seedActorAndDevice(t, database, "approver-phone", false)
	now := time.Now().UTC()
	require.NoError(t, database.Create(&session.SessionRecord{SessionID: "approver-session", UserID: 7,
		StationPeerID: stationID, DeviceID: "approver-phone", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}).Error)

	ctx := coreauth.WithSubject(context.Background(),
		&coreauth.Subject{ID: ptid, SessionID: "approver-session"})
	deviceID, err := infrastructure.ApproverOwner{}.RequireApprover(ctx, database, ptid, "new-phone")
	require.NoError(t, err)
	require.Equal(t, "approver-phone", deviceID)

	// The claimant cannot approve its own transaction.
	_, err = infrastructure.ApproverOwner{}.RequireApprover(ctx, database, ptid, "approver-phone")
	require.Error(t, err)

	// A revoked session fails closed.
	require.NoError(t, database.Model(&session.SessionRecord{}).
		Where("session_id = ?", "approver-session").Update("revoked", true).Error)
	_, err = infrastructure.ApproverOwner{}.RequireApprover(ctx, database, ptid, "new-phone")
	require.Error(t, err)
}

// TestAccessDeviceApprovalJourney_ApproverRejections pins the remaining
// fail-closed branches that protect the same-actor, enrolled-device boundary.
func TestAccessDeviceApprovalJourney_ApproverRejections(t *testing.T) {
	database := openDB(t)
	seedActorAndDevice(t, database, "approver-phone", false)
	now := time.Now().UTC()
	require.NoError(t, database.Create(&session.SessionRecord{SessionID: "approver-session", UserID: 7,
		StationPeerID: stationID, DeviceID: "approver-phone", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}).Error)

	owner := infrastructure.ApproverOwner{}

	// A request with no authenticated subject cannot approve anything.
	_, err := owner.RequireApprover(context.Background(), database, ptid, "new-phone")
	require.Error(t, err)

	// A different Actor's enrolled device must never approve this Actor's
	// transaction: the approval boundary is same-actor only.
	otherActorCtx := coreauth.WithSubject(context.Background(),
		&coreauth.Subject{ID: "ptid:v1:actor:peers:p:bob:test", SessionID: "approver-session"})
	_, err = owner.RequireApprover(otherActorCtx, database, ptid, "new-phone")
	require.Error(t, err)

	// A subject whose session id is empty is rejected before any DB read.
	emptySessionCtx := coreauth.WithSubject(context.Background(),
		&coreauth.Subject{ID: ptid, SessionID: ""})
	_, err = owner.RequireApprover(emptySessionCtx, database, ptid, "new-phone")
	require.Error(t, err)

	// An expired session fails closed even though the row is not revoked. The
	// expiry check precedes device lookup, so the device need not be enrolled.
	require.NoError(t, database.Create(&session.SessionRecord{SessionID: "expired-session", UserID: 7,
		StationPeerID: stationID, DeviceID: "expired-phone", CreatedAt: now,
		ExpiresAt: now.Add(-time.Minute)}).Error)
	expiredCtx := coreauth.WithSubject(context.Background(),
		&coreauth.Subject{ID: ptid, SessionID: "expired-session"})
	_, err = owner.RequireApprover(expiredCtx, database, ptid, "new-phone")
	require.Error(t, err)

	// A live session bound to a revoked device is not an eligible approver.
	require.NoError(t, database.Create(&identitydb.ActorDeviceModel{PTID: ptid, ActorAccount: "alice",
		DeviceID: "revoked-phone", Label: "revoked-phone", HomeStationPeerID: stationID,
		SigningKeyID: "key", PublicKey: make([]byte, 32), ProfileVersion: 1, Revoked: true,
		CreatedAt: now}).Error)
	require.NoError(t, database.Create(&session.SessionRecord{SessionID: "revoked-device-session", UserID: 7,
		StationPeerID: stationID, DeviceID: "revoked-phone", CreatedAt: now,
		ExpiresAt: now.Add(time.Hour)}).Error)
	revokedDeviceCtx := coreauth.WithSubject(context.Background(),
		&coreauth.Subject{ID: ptid, SessionID: "revoked-device-session"})
	_, err = owner.RequireApprover(revokedDeviceCtx, database, ptid, "new-phone")
	require.Error(t, err)

	// A live session whose device has no enrolled ActorDevice row fails closed.
	require.NoError(t, database.Create(&session.SessionRecord{SessionID: "ghost-device-session", UserID: 7,
		StationPeerID: stationID, DeviceID: "ghost-phone", CreatedAt: now,
		ExpiresAt: now.Add(time.Hour)}).Error)
	ghostCtx := coreauth.WithSubject(context.Background(),
		&coreauth.Subject{ID: ptid, SessionID: "ghost-device-session"})
	_, err = owner.RequireApprover(ghostCtx, database, ptid, "new-phone")
	require.Error(t, err)
}
