package session

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDBStoreSetRoundTripsAuthorizationMetadataIdempotently(t *testing.T) {
	store, db := newSQLiteDBStore(t)
	ctx := context.Background()
	sess := newPersistentTestSession("session-set", 41)
	sess.Data = map[string]interface{}{
		"device_type":              string(DeviceTypeMobile),
		"oauth_candidate_id":       "candidate-set",
		"access_attempt_id":        "access-attempt-set",
		"station_peer_id":          "station-peer-set",
		"access_decision_revision": uint64(7),
		"device_id":                "device-set",
		"lifecycle_generation":     uint64(3),
		"auth_method":              "oauth",
	}

	require.NoError(t, store.Set(ctx, sess.ID, sess))

	persisted, err := store.Get(ctx, sess.ID)
	require.NoError(t, err)
	require.Equal(t, sess.UserID, persisted.UserID)
	requireAuthorizationMetadata(t, persisted.Data, sess.Data)
	require.Equal(t, "device-set", store.ResolveSessionDeviceID(ctx, sess.ID))

	sess.Data["access_decision_revision"] = uint64(8)
	require.NoError(t, store.Set(ctx, sess.ID, sess))

	var count int64
	require.NoError(t, db.Model(&SessionRecord{}).
		Where("session_id = ?", sess.ID).
		Count(&count).Error)
	require.Equal(t, int64(1), count)

	persisted, err = store.Get(ctx, sess.ID)
	require.NoError(t, err)
	require.Equal(t, uint64(8), persisted.Data["access_decision_revision"])
}

func TestDBStoreCreateWithKickRoundTripsMetadataAndRejectsCandidateReuse(t *testing.T) {
	store, db := newSQLiteDBStore(t)
	ctx := context.Background()
	original := newPersistentTestSession("session-original", 42)
	original.Data = map[string]interface{}{
		"oauth_candidate_id":       "candidate-unique",
		"access_attempt_id":        "access-attempt-original",
		"station_peer_id":          "station-peer-original",
		"access_decision_revision": uint64(11),
		"device_id":                "device-original",
		"lifecycle_generation":     uint64(5),
		"auth_method":              "oauth",
	}

	_, kicked, err := store.CreateWithKick(ctx, original, DeviceTypeMobile)
	require.NoError(t, err)
	require.Zero(t, kicked)

	persisted, err := store.Get(ctx, original.ID)
	require.NoError(t, err)
	requireAuthorizationMetadata(t, persisted.Data, original.Data)
	require.Equal(t, string(DeviceTypeMobile), persisted.Data["device_type"])

	retry := newPersistentTestSession("session-retry", original.UserID)
	retry.Data = map[string]interface{}{
		"oauth_candidate_id":       original.Data["oauth_candidate_id"],
		"access_attempt_id":        original.Data["access_attempt_id"],
		"station_peer_id":          original.Data["station_peer_id"],
		"access_decision_revision": original.Data["access_decision_revision"],
		"device_id":                original.Data["device_id"],
		"lifecycle_generation":     original.Data["lifecycle_generation"],
		"auth_method":              original.Data["auth_method"],
	}

	_, _, err = store.CreateWithKick(ctx, retry, DeviceTypeMobile)
	require.Error(t, err)

	valid, reason := store.CheckSessionValid(ctx, original.ID)
	require.True(t, valid)
	require.Empty(t, reason)

	var candidateCount int64
	require.NoError(t, db.Model(&SessionRecord{}).
		Where("oauth_candidate_id = ?", "candidate-unique").
		Count(&candidateCount).Error)
	require.Equal(t, int64(1), candidateCount)
}

func TestDBStoreCreateWithKickReplacesSameClassAndPreservesOtherClasses(t *testing.T) {
	store, _ := newSQLiteDBStore(t)
	ctx := context.Background()

	desktopOld := newPersistentTestSession("desktop-old", 41)
	desktopOld.Data["device_id"] = "desktop-device-old"
	_, kicked, err := store.CreateWithKick(ctx, desktopOld, DeviceTypeDesktop)
	require.NoError(t, err)
	require.Zero(t, kicked)

	mobile := newPersistentTestSession("mobile-current", 41)
	mobile.Data["device_id"] = "mobile-device"
	_, kicked, err = store.CreateWithKick(ctx, mobile, DeviceTypeMobile)
	require.NoError(t, err)
	require.Zero(t, kicked)

	desktopNew := newPersistentTestSession("desktop-new", 41)
	desktopNew.Data["device_id"] = "desktop-device-new"
	_, kicked, err = store.CreateWithKick(ctx, desktopNew, DeviceTypeDesktop)
	require.NoError(t, err)
	require.Equal(t, int64(1), kicked)

	valid, reason := store.CheckSessionValid(ctx, desktopOld.ID)
	require.False(t, valid)
	require.Equal(t, "kicked", reason)
	valid, reason = store.CheckSessionValid(ctx, mobile.ID)
	require.True(t, valid)
	require.Empty(t, reason)
	valid, reason = store.CheckSessionValid(ctx, desktopNew.ID)
	require.True(t, valid)
	require.Empty(t, reason)
}

func TestDBStoreRejectsNonCanonicalClientClass(t *testing.T) {
	store, _ := newSQLiteDBStore(t)
	sess := newPersistentTestSession("invalid-class", 41)

	_, _, err := store.CreateWithKick(
		context.Background(),
		sess,
		DeviceType("desktop-native"),
	)
	require.ErrorIs(t, err, ErrInvalidDeviceType)
}

func TestDBStoreConcurrentSameClassActivationConvergesToOneWinner(t *testing.T) {
	store, db := newSQLiteDBStore(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	ctx := context.Background()
	start := make(chan struct{})
	errorsBySession := make(chan error, 2)
	var wait sync.WaitGroup
	for _, sessionID := range []string{"desktop-concurrent-a", "desktop-concurrent-b"} {
		sessionID := sessionID
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, _, err := store.CreateWithKick(
				ctx,
				newPersistentTestSession(sessionID, 41),
				DeviceTypeDesktop,
			)
			errorsBySession <- err
		}()
	}
	close(start)
	wait.Wait()
	close(errorsBySession)
	for err := range errorsBySession {
		require.NoError(t, err)
	}

	var activeCount int64
	require.NoError(t, db.Model(&SessionRecord{}).
		Where(
			"user_id = ? AND device_type = ? AND revoked = ?",
			41,
			DeviceTypeDesktop,
			false,
		).
		Count(&activeCount).Error)
	require.Equal(t, int64(1), activeCount)

	var revokedCount int64
	require.NoError(t, db.Model(&SessionRecord{}).
		Where(
			"user_id = ? AND device_type = ? AND revoked = ? AND revoked_reason = ?",
			41,
			DeviceTypeDesktop,
			true,
			"kicked",
		).
		Count(&revokedCount).Error)
	require.Equal(t, int64(1), revokedCount)
}

func TestDBStoreAutoMigrateNormalizesAndDeduplicatesClientClasses(t *testing.T) {
	db := newLegacySessionDatabase(t)
	now := time.Now().UTC().Truncate(time.Second)
	records := []SessionRecord{
		{
			SessionID: "desktop-legacy",
			UserID:    41, DeviceType: DeviceType("desktop-native"),
			CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActiveAt: now,
		},
		{
			SessionID: "desktop-winner",
			UserID:    41, DeviceType: DeviceTypeDesktop,
			CreatedAt: now.Add(time.Minute), ExpiresAt: now.Add(time.Hour), LastActiveAt: now,
		},
		{
			SessionID: "mobile-current",
			UserID:    41, DeviceType: DeviceTypeMobile,
			CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActiveAt: now,
		},
	}
	require.NoError(t, db.Create(&records).Error)

	store := NewDBStore(func(context.Context) (*gorm.DB, error) {
		return db, nil
	}, time.Hour)
	require.NoError(t, store.AutoMigrate(context.Background()))

	var legacy SessionRecord
	require.NoError(t, db.Where("session_id = ?", "desktop-legacy").First(&legacy).Error)
	require.Equal(t, DeviceTypeDesktop, legacy.DeviceType)
	require.True(t, legacy.Revoked)
	require.Equal(t, "kicked", legacy.RevokedReason)

	for _, sessionID := range []string{"desktop-winner", "mobile-current"} {
		var record SessionRecord
		require.NoError(t, db.Where("session_id = ?", sessionID).First(&record).Error)
		require.False(t, record.Revoked, sessionID)
	}
	require.True(t, db.Migrator().HasIndex(&SessionRecord{}, activeClientClassIndex))

	duplicate := SessionRecord{
		SessionID: "desktop-duplicate",
		UserID:    41, DeviceType: DeviceTypeDesktop,
		CreatedAt: now.Add(2 * time.Minute), ExpiresAt: now.Add(time.Hour), LastActiveAt: now,
	}
	require.Error(t, db.Create(&duplicate).Error)
}

func TestDBStoreAutoMigrateRejectsUnknownPersistedClientClass(t *testing.T) {
	db := newLegacySessionDatabase(t)
	now := time.Now().UTC()
	require.NoError(t, db.Create(&SessionRecord{
		SessionID: "unknown-class",
		UserID:    41, DeviceType: DeviceType("tablet"),
		CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActiveAt: now,
	}).Error)

	store := NewDBStore(func(context.Context) (*gorm.DB, error) {
		return db, nil
	}, time.Hour)
	require.ErrorIs(t, store.AutoMigrate(context.Background()), ErrInvalidDeviceType)
}

func TestDBStoreAllowsMultipleNonOAuthSessions(t *testing.T) {
	store, db := newSQLiteDBStore(t)
	ctx := context.Background()

	for index, sessionID := range []string{"session-password-1", "session-password-2"} {
		sess := newPersistentTestSession(sessionID, uint64(100+index))
		sess.Data = map[string]interface{}{
			"device_type": string(DeviceTypeDesktop),
			"auth_method": "password",
		}
		require.NoError(t, store.Set(ctx, sess.ID, sess))

		persisted, err := store.Get(ctx, sess.ID)
		require.NoError(t, err)
		require.Equal(t, "password", persisted.Data["auth_method"])
		require.Equal(t, "", persisted.Data["oauth_candidate_id"])
	}

	var count int64
	require.NoError(t, db.Model(&SessionRecord{}).
		Where("oauth_candidate_id = ?", "").
		Count(&count).Error)
	require.Equal(t, int64(2), count)
}

func newSQLiteDBStore(t *testing.T) (*DBStore, *gorm.DB) {
	t.Helper()

	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	require.NoError(t, err)

	require.NoError(t, db.Exec("CREATE TABLE touch_actor (id INTEGER PRIMARY KEY)").Error)
	for _, userID := range []uint64{17, 41, 42, 100, 101} {
		require.NoError(t, db.Exec("INSERT INTO touch_actor(id) VALUES (?)", userID).Error)
	}

	store := NewDBStore(func(context.Context) (*gorm.DB, error) {
		return db, nil
	}, time.Hour)
	require.NoError(t, store.AutoMigrate(context.Background()))

	return store, db
}

func newLegacySessionDatabase(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&SessionRecord{}))
	return db
}

func newPersistentTestSession(sessionID string, userID uint64) *Session {
	now := time.Now().UTC().Truncate(time.Second)
	return &Session{
		ID:        sessionID,
		UserID:    userID,
		Email:     sessionID + "@example.test",
		CreatedAt: now,
		ExpiresAt: now.Add(time.Hour),
		LastSeen:  now,
		IPAddress: "127.0.0.1",
		UserAgent: "session-store-test",
		Data:      map[string]interface{}{},
	}
}

func requireAuthorizationMetadata(
	t *testing.T,
	actual map[string]interface{},
	expected map[string]interface{},
) {
	t.Helper()

	for _, key := range []string{
		"oauth_candidate_id",
		"access_attempt_id",
		"station_peer_id",
		"access_decision_revision",
		"device_id",
		"lifecycle_generation",
		"auth_method",
	} {
		require.Equal(t, expected[key], actual[key], key)
	}
}
