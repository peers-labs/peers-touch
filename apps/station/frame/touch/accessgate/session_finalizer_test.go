package accessgate

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAccessGateSessionDeviceType(t *testing.T) {
	tests := []struct {
		name     string
		platform string
		want     session.DeviceType
		wantErr  bool
	}{
		{name: "desktop", platform: "desktop", want: session.DeviceTypeDesktop},
		{name: "mobile", platform: "mobile", want: session.DeviceTypeMobile},
		{name: "web", platform: "web", want: session.DeviceTypeWeb},
		{name: "trimmed", platform: " desktop ", want: session.DeviceTypeDesktop},
		{name: "missing", wantErr: true},
		{name: "unknown", platform: "tablet", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := accessGateSessionDeviceType(test.platform)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.want, got)
		})
	}
}

func TestRevokeReplacedAccessGateSessionsOnlyRevokesSameDevice(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&session.SessionRecord{}))

	now := time.Now().UTC().Truncate(time.Second)
	records := []session.SessionRecord{
		accessGateSessionRecord("desktop-old", 41, session.DeviceTypeDesktop, "desktop-device", now),
		accessGateSessionRecord("desktop-current", 41, session.DeviceTypeDesktop, "desktop-device", now),
		accessGateSessionRecord("desktop-other", 41, session.DeviceTypeDesktop, "other-desktop-device", now),
		accessGateSessionRecord("mobile-other", 41, session.DeviceTypeMobile, "mobile-device", now),
		accessGateSessionRecord("other-actor", 42, session.DeviceTypeDesktop, "desktop-device", now),
		accessGateSessionRecord("already-revoked", 41, session.DeviceTypeDesktop, "desktop-device", now),
	}
	records[5].Revoked = true
	records[5].RevokedReason = "logout"
	require.NoError(t, database.Create(&records).Error)

	require.NoError(t, revokeReplacedAccessGateSessions(
		database,
		41,
		"desktop-device",
		"desktop-current",
		now.Add(time.Minute),
	))

	assertAccessGateSessionState(t, database, "desktop-old", true, "kicked")
	assertAccessGateSessionState(t, database, "desktop-current", false, "")
	assertAccessGateSessionState(t, database, "desktop-other", false, "")
	assertAccessGateSessionState(t, database, "mobile-other", false, "")
	assertAccessGateSessionState(t, database, "other-actor", false, "")
	assertAccessGateSessionState(t, database, "already-revoked", true, "logout")
}

func accessGateSessionRecord(
	sessionID string,
	userID uint64,
	deviceType session.DeviceType,
	deviceID string,
	now time.Time,
) session.SessionRecord {
	return session.SessionRecord{
		SessionID:    sessionID,
		UserID:       userID,
		DeviceType:   deviceType,
		DeviceID:     deviceID,
		CreatedAt:    now,
		ExpiresAt:    now.Add(time.Hour),
		LastActiveAt: now,
		AuthMethod:   "access_gate",
	}
}

func assertAccessGateSessionState(
	t *testing.T,
	database *gorm.DB,
	sessionID string,
	revoked bool,
	reason string,
) {
	t.Helper()
	var record session.SessionRecord
	require.NoError(t, database.Where("session_id = ?", sessionID).First(&record).Error)
	require.Equal(t, revoked, record.Revoked)
	require.Equal(t, reason, record.RevokedReason)
}
