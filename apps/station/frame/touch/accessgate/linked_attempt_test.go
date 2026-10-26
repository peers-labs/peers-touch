package accessgate

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func linkedTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	// A hidden owner connection deadlocks instead of silently reading outside
	// the transaction. Context deadlines make such a regression bounded.
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, database.AutoMigrate(&dbmodel.AccessPolicy{}, &dbmodel.AccessAttempt{}, &dbmodel.AccessGateSubmission{}))
	require.NoError(t, database.Exec(`CREATE TABLE touch_actor (
		id INTEGER PRIMARY KEY, ptid TEXT, preferred_username TEXT, email TEXT,
		federated_handle TEXT, kind TEXT
	)`).Error)
	require.NoError(t, database.Exec(`INSERT INTO touch_actor VALUES
		(1, 'actor-ptid', 'person', 'person@example.test', '@person@example.test', 'p')`).Error)
	_, err = coreauth.OpenStationAccessKeyring(context.Background(), database,
		"public-test-key-material-for-linked-transactions", "")
	require.NoError(t, err)
	require.NoError(t, database.Create(&dbmodel.AccessPolicy{Mode: policyModeOpen}).Error)
	require.NoError(t, database.Create(&dbmodel.AccessAttempt{
		ID: "linked-attempt", StationPeerID: "station-test", DeviceID: "phone",
		Platform: "ios", LifecycleGeneration: 1, Status: attemptStatusGranted,
		ActorPTID: "actor-ptid", ActorKind: 1, ActorUsername: "person", ActorEmail: "person@example.test",
		AuthMethod: "device_link", DecisionRevision: 4, ExpiresAt: time.Now().Add(time.Minute),
	}).Error)
	return database
}

func TestLinkedDecisionRechecksPolicyAndKeepsUnchangedCredentialRevision(t *testing.T) {
	database := linkedTestDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		attempt, decision, err := ReevaluateLinkedInTransaction(tx, "linked-attempt", time.Now())
		require.NoError(t, err)
		require.Equal(t, pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED, decision.GetState())
		require.Equal(t, uint64(4), attempt.DecisionRevision)
		require.Equal(t, "person@example.test", decision.GetActor().GetAcct())
		return nil
	}))
	require.NoError(t, database.Model(&dbmodel.AccessPolicy{}).Where("1 = 1").Update("mode", policyModeClosed).Error)
	require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		attempt, decision, err := ReevaluateLinkedInTransaction(tx, "linked-attempt", time.Now())
		require.NoError(t, err)
		require.Equal(t, pb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED, decision.GetState())
		require.Equal(t, uint64(5), attempt.DecisionRevision)
		return nil
	}))
	_, _, err := ReevaluateLinkedInTransaction(database, "linked-attempt", time.Now())
	require.Error(t, err)
}

func TestLinkedTermsSubmissionUsesCanonicalDescriptorAndAtomicRetry(t *testing.T) {
	database := linkedTestDatabase(t)
	require.NoError(t, database.Model(&dbmodel.AccessPolicy{}).Where("1 = 1").
		Update("enabled_gates", encodeEnabledGates([]pb.AccessGateType{
			pb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
			pb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			pb.AccessGateType_ACCESS_GATE_TYPE_TERMS_ACCEPTANCE,
		})).Error)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var request *pb.SubmitAccessGateRequest
	require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, decision, err := ReevaluateLinkedInTransaction(tx, "linked-attempt", time.Now())
		require.NoError(t, err)
		require.Equal(t, pb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED, decision.GetState())
		gate := decision.GetGates()[2]
		request = &pb.SubmitAccessGateRequest{
			AttemptId: "linked-attempt", StationPeerId: "station-test", DeviceId: "phone", LifecycleGeneration: 1,
			SubmissionId: "terms-request", GateId: gate.GetGateId(), Type: gate.GetType(),
			ActionId: gate.GetActionId(), SchemaRevision: gate.GetSchemaRevision(), SchemaDigest: gate.GetSchemaDigest(),
			ActionInput: &pb.SubmitAccessGateRequest_Generic{Generic: &pb.AccessGateGenericInput{Fields: []*pb.AccessGateScalarValue{{
				FieldName: "accepted", Value: &pb.AccessGateScalarValue_BoolValue{BoolValue: true},
			}}}},
		}
		return nil
	}))
	var revision uint64
	for range 2 {
		require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			attempt, decision, err := SubmitLinkedActionInTransaction(tx, request, time.Now())
			require.NoError(t, err)
			require.Equal(t, pb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED, decision.GetState())
			if revision != 0 {
				require.Equal(t, revision, attempt.DecisionRevision)
			}
			revision = attempt.DecisionRevision
			return nil
		}))
	}
	request.GetGeneric().Fields[0].Value = &pb.AccessGateScalarValue_BoolValue{BoolValue: false}
	require.Error(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, _, err := SubmitLinkedActionInTransaction(tx, request, time.Now())
		return err
	}))
	var count int64
	require.NoError(t, database.Model(&dbmodel.AccessGateSubmission{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
}
