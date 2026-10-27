package application_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"

	"github.com/google/uuid"
	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func (f *fixture) createRequest(t *testing.T) *pb.CreateDeviceLinkRequest {
	t.Helper()
	key, err := link.Random(32)
	require.NoError(t, err)
	request := &pb.CreateDeviceLinkRequest{
		RequestId: uuid.NewString(), DesktopHpkePublicKey: key,
		DesktopCertificate: f.desktopCertificate, DesktopActorCrossSignature: f.desktopCertificateSignature,
	}
	request.DeviceSignature = sign(t, request, f.desktopKey, "create")
	return request
}

func TestCreateLostResponseReplaysAfterProfileChange(t *testing.T) {
	f := newFixture(t)
	request := f.createRequest(t)
	original, err := f.service.Create(f.desktop, request)
	require.NoError(t, err)
	require.NoError(t, f.database.Model(&identitydb.ActorIdentityModel{}).
		Where("ptid = ?", f.actor.PTID).Update("profile_version", 2).Error)
	replayed, err := f.service.Create(f.desktop, request)
	require.NoError(t, err)
	require.True(t, proto.Equal(original, replayed))
	var count int64
	require.NoError(t, f.database.Model(&rows.Offer{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
	request.DesktopHpkePublicKey[0] ^= 1
	request.DeviceSignature = nil
	request.DeviceSignature = sign(t, request, f.desktopKey, "create")
	_, err = f.service.Create(f.desktop, request)
	require.Error(t, err)
}

func TestCreateDefinitivelyStaleRequestAllocatesNothing(t *testing.T) {
	f := newFixture(t)
	request := f.createRequest(t)
	require.NoError(t, f.database.Model(&identitydb.ActorIdentityModel{}).
		Where("ptid = ?", f.actor.PTID).Update("profile_version", 2).Error)
	_, err := f.service.Create(f.desktop, request)
	require.Error(t, err)
	var typed *link.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_PROFILE_STALE, typed.Code)
	var count int64
	require.NoError(t, f.database.Model(&rows.Offer{}).Count(&count).Error)
	require.Zero(t, count)
	f.desktopCertificate, f.desktopCertificateSignature = f.certificate(t, "desktop", f.desktopKey, 2)
	_, err = f.service.Create(f.desktop, f.createRequest(t))
	require.NoError(t, err)
}

func TestFreshCreateRetiresOnlyOriginalSessionOrphan(t *testing.T) {
	f := newFixture(t)
	original := f.create(t)
	phone := f.claim(t, original)
	next, err := f.service.Create(f.desktop, f.createRequest(t))
	require.NoError(t, err)
	var old rows.Offer
	require.NoError(t, f.database.Where("id = ?", phone.offerID).First(&old).Error)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED, old.State)
	require.Nil(t, old.LiveActor)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED, phone.status(t, f).State)
	var live rows.Offer
	require.NoError(t, f.database.Where("live_actor = ?", f.actor.PTID).First(&live).Error)
	require.NotEqual(t, old.ID, live.ID)
	require.Equal(t, next.Revision, live.Revision)

	now := time.Now().UTC()
	_, otherKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	certificate, signature := f.certificate(t, "another-desktop", otherKey, 1)
	require.NoError(t, f.database.Transaction(func(tx *gorm.DB) error {
		_, err := f.service.Identity.CommitLinkedEnrollment(tx, identity.Enrollment{
			FormatVersion: 1, PTID: f.actor.PTID, ActorAccount: certificate.Device.Actor.Acct, ActorKind: 1,
			DeviceID: "another-desktop", HomeStationPeerID: f.network.station,
			ActorIdentityPublicKey:   certificate.ActorIdentityPublicKey,
			ActorIdentityFingerprint: certificate.ActorIdentityKeyFingerprint,
			DeviceSigningPublicKey:   certificate.DeviceSigningPublicKey, SigningKeyID: certificate.SigningKeyId,
			ProfileVersion: 1, CanonicalCertificateBytes: encode(t, certificate), ActorCrossSignature: signature,
		}, now)
		return err
	}))
	require.NoError(t, f.database.Create(&session.SessionRecord{
		SessionID: "another-desktop-session", UserID: f.actor.ID, DeviceType: session.DeviceTypeDesktop,
		StationPeerID: f.network.station, DeviceID: "another-desktop", CreatedAt: now, ExpiresAt: now.Add(time.Hour),
	}).Error)
	other := coreauth.WithSubject(context.Background(), &coreauth.Subject{
		ID: f.actor.PTID, SessionID: "another-desktop-session",
	})
	otherRequest := f.createRequest(t)
	otherRequest.DesktopCertificate, otherRequest.DesktopActorCrossSignature = certificate, signature
	otherRequest.DeviceSignature = nil
	otherRequest.DeviceSignature = sign(t, otherRequest, otherKey, "create")
	_, err = f.service.Create(other, otherRequest)
	require.Error(t, err)
	require.NoError(t, f.database.Where("id = ?", live.ID).First(&live).Error)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_OPEN, live.State)
}

func TestFreshCreatePreservesCommittedPhone(t *testing.T) {
	f := newFixture(t)
	offer := f.create(t)
	phone := f.claim(t, offer)
	approved := f.approve(t, offer, phone, phone.status(t, f).Revision)
	f.prove(t, phone, approved.Revision)
	ack, err := f.service.Acknowledge(context.Background(), phone.ackRequest(t, phone.material(t, f)))
	require.NoError(t, err)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED, ack.State)
	_, err = f.service.Create(f.desktop, f.createRequest(t))
	require.NoError(t, err)
	var committed rows.Offer
	require.NoError(t, f.database.Where("id = ?", phone.offerID).First(&committed).Error)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED, committed.State)
	var active session.SessionRecord
	require.NoError(t, f.database.Where("session_id = ?", committed.SessionID).First(&active).Error)
	require.False(t, active.Revoked)
}
