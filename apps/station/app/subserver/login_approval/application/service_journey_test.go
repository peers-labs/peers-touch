package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/login_approval/application"
	link "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/domain"
	linkdb "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	devicelink "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	actorPTID = "ptid:v1:actor:peers:p:alice:test"
	stationID = "station-test"
)

type fakeAttempts struct {
	enrolled int
	fail     bool
}

func (f fakeAttempts) ResolveCredentialAttempt(_ context.Context, _ *gorm.DB, _ string,
	_ uint64, _ string) (*application.AttemptBinding, error) {
	if f.fail {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNAUTHORIZED_ATTEMPT)
	}
	return &application.AttemptBinding{UserID: 7, ActorPTID: actorPTID,
		StationPeerID: stationID, EnrolledDeviceCount: f.enrolled}, nil
}

type fakeApprover struct{}

func (fakeApprover) RequireApprover(_ context.Context, _ *gorm.DB, actor, claimantDeviceID string) (string, error) {
	if actor != actorPTID {
		return "", link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVER_REVOKED)
	}
	if claimantDeviceID == "same-as-approver" {
		return "", link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVER_REVOKED)
	}
	return "approver-device", nil
}

func newService(t *testing.T, enrolled int) (*application.Service, *gorm.DB) {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, linkdb.Migrate(database))
	clock := func() time.Time { return time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC) }
	return &application.Service{
		Database: func(context.Context) (*gorm.DB, error) { return database, nil },
		Attempts: fakeAttempts{enrolled: enrolled},
		Approver: fakeApprover{},
		Clock:    clock,
	}, database
}

func createRequest() *pb.CreateLoginApprovalRequest {
	return &pb.CreateLoginApprovalRequest{
		RequestId: uuid.NewString(), AccessAttemptId: "attempt-1", AccessDecisionRevision: 3,
		StationPeerId: stationID, ClaimantDeviceId: "phone-new", Platform: "ios",
		DeviceLabel: "Alice iPhone", ClaimantHpkePublicKey: make([]byte, 32),
		ClaimantDeviceSigningPublicKey: make([]byte, 32),
	}
}

func approverContext() context.Context {
	return coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: actorPTID, SessionID: "approver-session"})
}

func TestLoginApprovalJourney_CreateStatusApprove(t *testing.T) {
	service, _ := newService(t, 2)
	response, err := service.Create(context.Background(), createRequest())
	require.NoError(t, err)
	require.NotEmpty(t, response.ApprovalId)
	require.Len(t, response.ClaimantCapability, 32)
	require.Len(t, response.ComparisonCode, 6)
	require.Equal(t, uint64(1), response.Revision)

	status, err := service.Status(context.Background(), &pb.LoginApprovalStatusRequest{
		ApprovalId: response.ApprovalId, ClaimantCapability: response.ClaimantCapability})
	require.NoError(t, err)
	require.Equal(t, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING, status.Status.State)

	pending, err := service.ListPending(approverContext(), &pb.ListPendingLoginApprovalsRequest{})
	require.NoError(t, err)
	require.Len(t, pending.Approvals, 1)
	require.Equal(t, response.ComparisonCode, pending.Approvals[0].ComparisonCode)

	approved, err := service.Approve(approverContext(), &pb.ApproveLoginApprovalRequest{
		ApprovalId: response.ApprovalId, ObservedRevision: 1,
		IdentityMaterial:            &devicelink.DeviceLinkHpkeEnvelope{ProtocolVersion: 1, Ciphertext: []byte("sealed")},
		ApproverTranscriptSignature: []byte("signature")})
	require.NoError(t, err)
	require.Equal(t, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_APPROVED, approved.Status.State)

	// A second approve loses the CAS race because the revision already advanced.
	_, err = service.Approve(approverContext(), &pb.ApproveLoginApprovalRequest{
		ApprovalId: response.ApprovalId, ObservedRevision: 1,
		IdentityMaterial:            &devicelink.DeviceLinkHpkeEnvelope{ProtocolVersion: 1},
		ApproverTranscriptSignature: []byte("again")})
	require.Error(t, err)
}

func TestLoginApprovalJourney_CapabilityAndCancel(t *testing.T) {
	service, _ := newService(t, 1)
	response, err := service.Create(context.Background(), createRequest())
	require.NoError(t, err)

	_, err = service.Status(context.Background(), &pb.LoginApprovalStatusRequest{
		ApprovalId: response.ApprovalId, ClaimantCapability: make([]byte, 32)})
	require.Error(t, err)

	cancelled, err := service.Cancel(context.Background(), &pb.CancelLoginApprovalRequest{
		ApprovalId: response.ApprovalId, ClaimantCapability: response.ClaimantCapability, ObservedRevision: 1})
	require.NoError(t, err)
	require.Equal(t, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_CANCELLED, cancelled.Status.State)
}

func TestLoginApprovalJourney_Deny(t *testing.T) {
	service, _ := newService(t, 1)
	response, err := service.Create(context.Background(), createRequest())
	require.NoError(t, err)
	denied, err := service.Deny(approverContext(), &pb.DenyLoginApprovalRequest{
		ApprovalId: response.ApprovalId, ObservedRevision: 1})
	require.NoError(t, err)
	require.Equal(t, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_DENIED, denied.Status.State)
}

func TestLoginApprovalJourney_NoApproverAndBadAttempt(t *testing.T) {
	noApprover, _ := newService(t, 0)
	_, err := noApprover.Create(context.Background(), createRequest())
	require.Error(t, err)

	bad, _ := newService(t, 2)
	bad.Attempts = fakeAttempts{enrolled: 2, fail: true}
	_, err = bad.Create(context.Background(), createRequest())
	require.Error(t, err)
}

func TestLoginApprovalJourney_PendingBudget(t *testing.T) {
	service, _ := newService(t, 2)
	for i := 0; i < link.MaxPendingPerActor; i++ {
		_, err := service.Create(context.Background(), createRequest())
		require.NoError(t, err)
	}
	_, err := service.Create(context.Background(), createRequest())
	require.Error(t, err)
}

func TestLoginApprovalJourney_ApproveProjectsToClaimant(t *testing.T) {
	service, _ := newService(t, 2)
	created, err := service.Create(context.Background(), createRequest())
	require.NoError(t, err)

	approved, err := service.Approve(approverContext(), &pb.ApproveLoginApprovalRequest{
		ApprovalId: created.ApprovalId, ObservedRevision: 1,
		IdentityMaterial:            &devicelink.DeviceLinkHpkeEnvelope{ProtocolVersion: 1, Ciphertext: []byte("sealed")},
		ApproverTranscriptSignature: []byte("signature")})
	require.NoError(t, err)

	// The claimant observes the APPROVED terminal-ish state through the same
	// possession capability, never through an account enumeration path.
	status, err := service.Status(context.Background(), &pb.LoginApprovalStatusRequest{
		ApprovalId: created.ApprovalId, ClaimantCapability: created.ClaimantCapability})
	require.NoError(t, err)
	require.Equal(t, approved.Status.State, status.Status.State)
	require.Equal(t, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_APPROVED, status.Status.State)
}

func TestLoginApprovalJourney_ApproverMustDifferFromClaimant(t *testing.T) {
	service, _ := newService(t, 1)
	request := createRequest()
	request.ClaimantDeviceId = "same-as-approver"
	_, err := service.Create(context.Background(), request)
	require.NoError(t, err)

	// The fake approver rejects a transaction whose device id equals its own.
	database, err := service.Database(context.Background())
	require.NoError(t, err)
	var approvalID string
	require.NoError(t, database.
		Model(&linkdb.Transaction{}).Select("id").Take(&approvalID).Error)
	_, err = service.Approve(approverContext(), &pb.ApproveLoginApprovalRequest{
		ApprovalId: approvalID, ObservedRevision: 1,
		IdentityMaterial:            &devicelink.DeviceLinkHpkeEnvelope{ProtocolVersion: 1},
		ApproverTranscriptSignature: []byte("signature")})
	require.Error(t, err)
}

func TestLoginApprovalJourney_SweepExpires(t *testing.T) {
	service, database := newService(t, 1)
	response, err := service.Create(context.Background(), createRequest())
	require.NoError(t, err)

	// Force the row past its TTL, then sweep.
	require.NoError(t, database.Model(&linkdb.Transaction{}).Where("id = ?", response.ApprovalId).
		Update("expires_at", time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)).Error)
	swept, err := service.Sweep(context.Background())
	require.NoError(t, err)
	require.Equal(t, int64(1), swept)

	// Terminal expiry is projected to the claimant rather than masked, so the
	// login card can render the typed expiration reason.
	status, err := service.Status(context.Background(), &pb.LoginApprovalStatusRequest{
		ApprovalId: response.ApprovalId, ClaimantCapability: response.ClaimantCapability})
	require.NoError(t, err)
	require.Equal(t, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_EXPIRED, status.Status.State)
}
