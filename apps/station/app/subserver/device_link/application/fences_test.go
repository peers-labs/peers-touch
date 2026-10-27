package application_test

import (
	"context"
	"errors"
	"testing"

	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"github.com/stretchr/testify/require"
)

func TestProfileRefreshKeepsApprovalImmutableAndReplacesInactiveDelivery(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	approved := f.approve(t, offer, phone, phone.status(t, f).Revision)
	f.prove(t, phone, approved.Revision)
	old := phone.material(t, f)
	require.NoError(t, f.database.Model(&identitydb.ActorIdentityModel{}).Where("ptid = ?", f.actor.PTID).
		Update("profile_version", 2).Error)
	query := &pb.GetDeviceLinkStatusRequest{OfferId: phone.offerID, ClaimAuthorization: phone.authorization()}
	query.ClaimAuthorization.DeviceSignature = sign(t, query, phone.key, "status")
	_, err := f.service.Status(context.Background(), query)
	var stale *link.Error
	require.True(t, errors.As(err, &stale))
	require.Equal(t, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_PROFILE_STALE, stale.Code)
	require.Equal(t, uint64(2), stale.Status.CurrentProfileRevision)
	mobile := &pb.DeviceLinkClaimStatement{}
	require.NoError(t, link.Decode(phone.claim.Claim.StatementBytes, mobile))
	certificate, signature := f.certificate(t, mobile.MobileDeviceId, phone.key, 2)
	request := &pb.ProveDeviceLinkDeviceRequest{Authorization: phone.authorization(), ObservedRevision: stale.Status.Revision,
		Enrollment: &model.EnrollActorDeviceRequest{Certificate: certificate, ActorCrossSignature: signature, Label: "Phone"}}
	request.Authorization.DeviceSignature = sign(t, request, phone.key, "prove")
	_, err = f.service.Prove(context.Background(), request)
	require.NoError(t, err)
	fresh := phone.material(t, f)
	require.NotEqual(t, old.Status.DeliveryId, fresh.Status.DeliveryId)
	require.Equal(t, old.IdentityMaterial.TranscriptBytes, fresh.IdentityMaterial.TranscriptBytes)
	_, err = f.service.Acknowledge(context.Background(), phone.ackRequest(t, old))
	require.Error(t, err)
	_, err = f.service.Acknowledge(context.Background(), phone.ackRequest(t, fresh))
	require.NoError(t, err)
}

func TestApproverRevocationCancelsPreparedDeliveryWithoutActivatingPhone(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	approved := f.approve(t, offer, phone, phone.status(t, f).Revision)
	f.prove(t, phone, approved.Revision)
	credential := phone.material(t, f)
	require.NoError(t, f.database.Model(&identitydb.ActorDeviceModel{}).Where("device_id = ?", "desktop").Update("revoked", true).Error)
	_, err := f.service.Acknowledge(context.Background(), phone.ackRequest(t, credential))
	require.Error(t, err)
	var devices int64
	require.NoError(t, f.database.Model(&identitydb.ActorDeviceModel{}).Count(&devices).Error)
	require.Equal(t, int64(1), devices)
	var pending int64
	require.NoError(t, f.database.Model(&session.SessionRecord{}).Where("auth_method = ?", "device_link").Count(&pending).Error)
	require.Zero(t, pending)
}
