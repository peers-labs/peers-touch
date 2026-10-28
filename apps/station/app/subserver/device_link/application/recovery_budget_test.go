package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"github.com/stretchr/testify/require"
)

func (f *fixture) cancelOffer(t *testing.T, offerID string, revision uint64) {
	t.Helper()
	request := &pb.CancelDeviceLinkRequest{OfferId: offerID, ObservedRevision: revision}
	request.DesktopDeviceSignature = sign(t, request, f.desktopKey, "cancel")
	_, err := f.service.Cancel(f.desktop, request)
	require.NoError(t, err)
}

func TestPreApprovalProfileRefreshAndPostApprovalExactRetry(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	require.NoError(t, f.database.Model(&identitydb.ActorIdentityModel{}).
		Where("ptid = ?", f.actor.PTID).Update("profile_version", 2).Error)
	fresh := phone.status(t, f)
	require.Greater(t, fresh.Revision, phone.claim.Revision)
	require.Equal(t, uint64(2), fresh.Claims[0].ProfileRevision)
	phone.claim.Claim = fresh.Claims[0]
	transcript, err := link.Approval(offer.Offer, phone.claim.Claim, fresh.Revision+1)
	require.NoError(t, err)
	raw := encode(t, transcript)
	envelope, err := infrastructure.SealCredential(phone.hpkePublic, raw, encode(t,
		&pb.DeviceLinkIdentityMaterial{ActorIdentitySeed: f.identityKey.Seed(),
			ActorIdentityKeyFingerprint: link.Digest(f.desktopCertificate.ActorIdentityPublicKey),
			ApprovalTranscriptDigest:    link.Digest(raw)}))
	require.NoError(t, err)
	request := &pb.ApproveDeviceLinkRequest{OfferId: phone.offerID, ClaimId: phone.claim.Claim.ClaimId,
		ObservedRevision: fresh.Revision, IdentityMaterial: envelope,
		DesktopTranscriptSignature: sign(t, transcript, f.desktopKey, "approval")}
	_, err = f.service.Approve(f.desktop, request)
	require.NoError(t, err)
	require.NoError(t, f.database.Model(&identitydb.ActorIdentityModel{}).
		Where("ptid = ?", f.actor.PTID).Update("profile_version", 3).Error)
	retry, err := f.service.Approve(f.desktop, request)
	require.NoError(t, err)
	require.Equal(t, uint64(3), retry.CurrentProfileRevision)
	var saved rows.Offer
	require.NoError(t, f.database.Where("id = ?", phone.offerID).First(&saved).Error)
	require.Equal(t, raw, saved.ApprovalTranscript)
	request.IdentityMaterial.Ciphertext[0] ^= 1
	_, err = f.service.Approve(f.desktop, request)
	require.Error(t, err)
}

func TestCancelledClaimRetryRetainsCapabilityAndDurableChurnIsBounded(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	f.cancelOffer(t, phone.offerID, phone.status(t, f).Revision)
	retry, err := f.service.Claim(context.Background(), phone.request)
	require.NoError(t, err)
	require.Equal(t, phone.claim.ClaimCapability, retry.ClaimCapability)
	phone.claim = retry
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED, phone.status(t, f).State)
	for i := 0; i < 7; i++ {
		next := f.create(t)
		statement := &pb.DeviceLinkOfferStatement{}
		require.NoError(t, link.Decode(next.Offer.StatementBytes, statement))
		f.cancelOffer(t, statement.OfferId, next.Revision)
	}
	request := &pb.CreateDeviceLinkRequest{RequestId: uuid.NewString(), DesktopHpkePublicKey: phone.hpkePublic,
		DesktopCertificate: f.desktopCertificate, DesktopActorCrossSignature: f.desktopCertificateSignature}
	request.DeviceSignature = sign(t, request, f.desktopKey, "create")
	_, err = f.service.Create(f.desktop, request)
	require.Error(t, err)
	var retained int64
	require.NoError(t, f.database.Model(&rows.Offer{}).Count(&retained).Error)
	require.Equal(t, int64(8), retained)
	require.NoError(t, f.database.Model(&rows.Offer{}).Where("1 = 1").
		Update("created_at", time.Now().UTC().Add(-2*time.Minute)).Error)
	_, err = f.service.Create(f.desktop, request)
	require.NoError(t, err)
}

func TestRetirementRemovesOnlyUncommittedAccessRecords(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	committed := f.claim(t, offer)
	approved := f.approve(t, offer, committed, committed.status(t, f).Revision)
	f.prove(t, committed, approved.Revision)
	_, err := f.service.Acknowledge(context.Background(), committed.ackRequest(t, committed.material(t, f)))
	require.NoError(t, err)
	next := f.create(t)
	cancelled := f.claim(t, next)
	require.NoError(t, f.database.Create(&db.AccessGateSubmission{
		AttemptID: cancelled.claim.Claim.AccessAttemptId, SubmissionID: "retained-action",
		GateID: "terms", ActionID: "accept", State: "completed",
	}).Error)
	f.cancelOffer(t, cancelled.offerID, cancelled.status(t, f).Revision)
	f.service.Clock = func() time.Time { return time.Now().Add(25 * time.Hour) }
	_, err = f.service.Sweep(context.Background())
	require.NoError(t, err)
	var attempts []db.AccessAttempt
	require.NoError(t, f.database.Find(&attempts).Error)
	require.Len(t, attempts, 1)
	require.Equal(t, committed.claim.Claim.AccessAttemptId, attempts[0].ID)
	require.NotEmpty(t, attempts[0].SessionID)
	var residue int64
	require.NoError(t, f.database.Model(&db.AccessGateSubmission{}).Count(&residue).Error)
	require.Zero(t, residue)
	require.NoError(t, f.database.Model(&rows.Offer{}).Count(&residue).Error)
	require.Zero(t, residue)
}
