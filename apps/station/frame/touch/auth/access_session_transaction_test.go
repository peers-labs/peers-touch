package auth

import (
	"context"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAccessSessionCredentialUsesCallerTransaction(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	const secret = "public-access-session-transaction-test"
	coreauth.Init(coreauth.Config{Secret: secret, AccessTTL: time.Hour})
	keyring, err := coreauth.OpenStationAccessKeyring(context.Background(), database, secret, "")
	require.NoError(t, err)
	coreauth.SetStationAccessKeyring(keyring)
	t.Cleanup(func() { coreauth.SetStationAccessKeyring(nil) })
	actor := credentialTestActor()
	var sessionID, token string

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		transactionKeyring, keyErr := coreauth.StationAccessKeyringInTransaction(tx)
		if keyErr != nil {
			return keyErr
		}
		record, response, prepareErr := PrepareAccessGateSession(
			ctx, actor,
			AccessGateSessionBinding{
				AccessAttemptID: "attempt-1", StationPeerID: "station-1",
				AccessDecisionRevision: 1, DeviceType: session.DeviceTypeDesktop,
				DeviceID: "device-1", LifecycleGeneration: 1,
			},
			"", "transaction-test", time.Now().UTC(),
			coreauth.WithStationAccessKeyring(transactionKeyring),
		)
		if prepareErr != nil {
			return prepareErr
		}
		require.Equal(t, record.SessionID, response.GetSessionId())
		assertCredentialActorRef(t, response.GetActorRef())
		resumed, resumeErr := ResumeAccessGateSession(
			ctx, actor, record, coreauth.WithStationAccessKeyring(transactionKeyring),
		)
		if resumeErr != nil {
			return resumeErr
		}
		require.Equal(t, record.SessionID, resumed.GetSessionId())
		assertCredentialActorRef(t, resumed.GetActorRef())
		sessionID, token = record.SessionID, resumed.GetTokens().GetAccessToken()
		return nil
	}))
	require.Zero(t, sqlDB.Stats().WaitCount, "credential issuance must not request a second database connection")
	subject, err := coreauth.NewJWTProvider(secret, time.Hour).Validate(ctx, token)
	require.NoError(t, err)
	require.Equal(t, actor.PTID, subject.ID)
	require.Equal(t, sessionID, subject.SessionID)
}
