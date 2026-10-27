package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func (f *fixture) approve(t *testing.T, offer *pb.CreateDeviceLinkResponse, phone *phone, revision uint64) *pb.DeviceLinkStatus {
	t.Helper()
	transcript, err := link.Approval(offer.Offer, phone.claim.Claim, revision+1)
	require.NoError(t, err)
	raw := encode(t, transcript)
	identityMaterial := &pb.DeviceLinkIdentityMaterial{ActorIdentitySeed: f.identityKey.Seed(),
		ActorIdentityKeyFingerprint: link.Digest(f.desktopCertificate.ActorIdentityPublicKey),
		ApprovalTranscriptDigest:    link.Digest(raw)}
	envelope, err := infrastructure.SealCredential(phone.hpkePublic, raw, encode(t, identityMaterial))
	require.NoError(t, err)
	request := &pb.ApproveDeviceLinkRequest{OfferId: phone.offerID, ClaimId: phone.claim.Claim.ClaimId,
		ObservedRevision: revision, IdentityMaterial: envelope,
		DesktopTranscriptSignature: sign(t, transcript, f.desktopKey, "approval")}
	response, err := f.service.Approve(f.desktop, request)
	require.NoError(t, err)
	retry, err := f.service.Approve(f.desktop, request)
	require.NoError(t, err)
	require.True(t, proto.Equal(response, retry))
	return response
}

func (p *phone) status(t *testing.T, f *fixture) *pb.DeviceLinkStatus {
	t.Helper()
	request := &pb.GetDeviceLinkStatusRequest{OfferId: p.offerID, ClaimAuthorization: p.authorization()}
	request.ClaimAuthorization.DeviceSignature = sign(t, request, p.key, "status")
	response, err := f.service.Status(context.Background(), request)
	require.NoError(t, err)
	return response
}

func (p *phone) material(t *testing.T, f *fixture) *pb.GetDeviceLinkMaterialResponse {
	t.Helper()
	request := &pb.GetDeviceLinkMaterialRequest{Authorization: p.authorization()}
	request.Authorization.DeviceSignature = sign(t, request, p.key, "material")
	response, err := f.service.Material(context.Background(), request)
	require.NoError(t, err)
	return response
}

func (f *fixture) prove(t *testing.T, phone *phone, revision uint64) {
	t.Helper()
	claim := &pb.DeviceLinkClaimStatement{}
	require.NoError(t, link.Decode(phone.claim.Claim.StatementBytes, claim))
	certificate, signature := f.certificate(t, claim.MobileDeviceId, phone.key, 1)
	request := &pb.ProveDeviceLinkDeviceRequest{Authorization: phone.authorization(), ObservedRevision: revision,
		Enrollment: &model.EnrollActorDeviceRequest{Certificate: certificate, ActorCrossSignature: signature, Label: "Phone"}}
	request.Authorization.DeviceSignature = sign(t, request, phone.key, "prove")
	_, err := f.service.Prove(context.Background(), request)
	require.NoError(t, err)
	_, err = f.service.Prove(context.Background(), request)
	require.NoError(t, err)
}

func (p *phone) ackRequest(t *testing.T, material *pb.GetDeviceLinkMaterialResponse) *pb.AcknowledgeDeviceLinkRequest {
	request := &pb.AcknowledgeDeviceLinkRequest{Authorization: p.authorization(),
		DeliveryId: material.Status.DeliveryId, CredentialDigest: material.Status.CredentialDigest}
	request.Authorization.DeviceSignature = sign(t, request, p.key, "ack")
	return request
}

func TestSharedTransactionApprovalIsolationSecureAckAndMultiplePhones(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	offer := f.create(t)
	first := f.claim(t, offer)
	unselected := f.claim(t, offer)
	status := first.status(t, f)
	require.Len(t, status.Claims, 1)
	require.Equal(t, first.claim.Claim.ClaimId, status.Claims[0].ClaimId)
	approved := f.approve(t, offer, first, status.Revision)
	identity := first.material(t, f)
	require.NotNil(t, identity.IdentityMaterial)
	require.Nil(t, identity.CredentialMaterial)
	bad := &pb.GetDeviceLinkMaterialRequest{Authorization: unselected.authorization()}
	bad.Authorization.DeviceSignature = sign(t, bad, unselected.key, "material")
	_, err := f.service.Material(ctx, bad)
	require.Error(t, err)
	f.prove(t, first, approved.Revision)
	credential := first.material(t, f)
	require.NotNil(t, credential.CredentialMaterial)
	retry := first.material(t, f)
	require.True(t, proto.Equal(credential, retry))
	var prepared rows.Offer
	require.NoError(t, f.database.Where("id = ?", first.offerID).First(&prepared).Error)
	var pending session.SessionRecord
	require.NoError(t, f.database.Where("session_id = ?", prepared.SessionID).First(&pending).Error)
	require.True(t, pending.Revoked)
	var devices int64
	require.NoError(t, f.database.Model(&identitydb.ActorDeviceModel{}).Count(&devices).Error)
	require.Equal(t, int64(1), devices)
	ack := first.ackRequest(t, credential)
	result, err := f.service.Acknowledge(ctx, ack)
	require.NoError(t, err)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED, result.State)
	retryAck, err := f.service.Acknowledge(ctx, ack)
	require.NoError(t, err)
	require.True(t, proto.Equal(result, retryAck))
	unselectedStatus := unselected.status(t, f)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_DENIED, unselectedStatus.State)
	require.Equal(t, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_NOT_SELECTED, unselectedStatus.Reason)
	require.Empty(t, unselectedStatus.DeliveryId)
	claimRetry, err := f.service.Claim(ctx, first.request)
	require.NoError(t, err)
	require.Equal(t, first.claim.ClaimCapability, claimRetry.ClaimCapability)
	first.claim = claimRetry
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED, first.status(t, f).State)
	secondOffer := f.create(t)
	second := f.claim(t, secondOffer)
	approved = f.approve(t, secondOffer, second, second.status(t, f).Revision)
	f.prove(t, second, approved.Revision)
	_, err = f.service.Acknowledge(ctx, second.ackRequest(t, second.material(t, f)))
	require.NoError(t, err)
	var active int64
	require.NoError(t, f.database.Model(&session.SessionRecord{}).Where("revoked = ?", false).Count(&active).Error)
	require.Equal(t, int64(3), active)
	require.NoError(t, f.database.Model(&identitydb.ActorDeviceModel{}).Count(&devices).Error)
	require.Equal(t, int64(3), devices)
}

func TestPolicyChangeRevokesDeliveryAndExpiryRemovesOnlyPendingScope(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	approved := f.approve(t, offer, phone, phone.status(t, f).Revision)
	f.prove(t, phone, approved.Revision)
	credential := phone.material(t, f)
	require.NoError(t, f.database.Model(&db.AccessPolicy{}).Where("1 = 1").Update("mode", "closed").Error)
	_, err := f.service.Acknowledge(context.Background(), phone.ackRequest(t, credential))
	require.Error(t, err)
	var active int64
	require.NoError(t, f.database.Model(&session.SessionRecord{}).Where("revoked = ?", false).Count(&active).Error)
	require.Equal(t, int64(1), active)
	var pending int64
	require.NoError(t, f.database.Model(&session.SessionRecord{}).Where("auth_method = ?", "device_link").Count(&pending).Error)
	require.Zero(t, pending)
	f.service.Clock = func() time.Time { return time.Now().Add(10 * time.Minute) }
	count, err := f.service.Sweep(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	require.NoError(t, f.database.Model(&session.SessionRecord{}).Where("revoked = ?", false).Count(&active).Error)
	require.Equal(t, int64(1), active)
}

func TestAcknowledgementRollbackNeverLeavesActiveDeviceOrSession(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	approved := f.approve(t, offer, phone, phone.status(t, f).Revision)
	f.prove(t, phone, approved.Revision)
	credential := phone.material(t, f)
	require.NoError(t, f.database.Callback().Update().Before("gorm:update").Register("fail_link_commit", func(tx *gorm.DB) {
		if tx.Statement.Table == "access_gate_attempts" {
			if updates, ok := tx.Statement.Dest.(map[string]interface{}); ok && updates["session_id"] != nil {
				tx.AddError(errors.New("injected Access commit failure"))
			}
		}
	}))
	_, err := f.service.Acknowledge(context.Background(), phone.ackRequest(t, credential))
	require.Error(t, err)
	require.NoError(t, f.database.Callback().Update().Remove("fail_link_commit"))
	var devices int64
	require.NoError(t, f.database.Model(&identitydb.ActorDeviceModel{}).Count(&devices).Error)
	require.Equal(t, int64(1), devices)
	var active int64
	require.NoError(t, f.database.Model(&session.SessionRecord{}).Where("revoked = ?", false).Count(&active).Error)
	require.Equal(t, int64(1), active)
}
