package application_test

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestExactExpiredCreateReturnsCommittedTerminalLookup(t *testing.T) {
	f := newFixture(t)
	request := f.createRequest(t)
	original, err := f.service.Create(f.desktop, request)
	require.NoError(t, err)
	statement := &pb.DeviceLinkOfferStatement{}
	require.NoError(t, link.Decode(original.Offer.StatementBytes, statement))
	f.service.Clock = func() time.Time { return time.UnixMilli(statement.ExpiresAtUnixMs).Add(time.Millisecond) }

	response, err := f.service.Create(f.desktop, request)
	require.Nil(t, response)
	var rejection *link.Error
	require.ErrorAs(t, err, &rejection)
	require.Equal(t, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED, rejection.Code)
	require.NotNil(t, rejection.Status)
	require.Equal(t, statement.OfferId, rejection.Status.OfferId)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_EXPIRED, rejection.Status.State)
	require.Empty(t, rejection.Status.Claims)
	require.Empty(t, rejection.Status.DeliveryId)
	var stored rows.Offer
	require.NoError(t, f.database.Where("id = ?", statement.OfferId).First(&stored).Error)
	require.Equal(t, rejection.Status.State, stored.State)
	require.Equal(t, rejection.Status.Revision, stored.Revision)
	require.Nil(t, stored.LiveActor)

	request.DesktopHpkePublicKey[0] ^= 1
	request.DeviceSignature = nil
	request.DeviceSignature = sign(t, request, f.desktopKey, "create")
	_, err = f.service.Create(f.desktop, request)
	rejection = nil
	require.ErrorAs(t, err, &rejection)
	require.Nil(t, rejection.Status)

	f.service.Clock = time.Now
	_, err = f.service.Create(f.desktop, f.createRequest(t))
	require.NoError(t, err)
}

func TestExactCancelledCreateReturnsOnlyOriginalTerminalLookup(t *testing.T) {
	f := newFixture(t)
	request := f.createRequest(t)
	original, err := f.service.Create(f.desktop, request)
	require.NoError(t, err)
	statement := &pb.DeviceLinkOfferStatement{}
	require.NoError(t, link.Decode(original.Offer.StatementBytes, statement))
	cancel := &pb.CancelDeviceLinkRequest{OfferId: statement.OfferId, ObservedRevision: original.Revision}
	cancel.DesktopDeviceSignature = sign(t, cancel, f.desktopKey, "cancel")
	_, err = f.service.Cancel(f.desktop, cancel)
	require.NoError(t, err)

	response, err := f.service.Create(f.desktop, request)
	require.Nil(t, response)
	var rejection *link.Error
	require.ErrorAs(t, err, &rejection)
	require.NotNil(t, rejection.Status)
	require.Equal(t, statement.OfferId, rejection.Status.OfferId)
	require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED, rejection.Status.State)
	require.Empty(t, rejection.Status.CredentialDigest)
}

func TestNewLoginRetiresInvalidOriginalSessionWithoutRecoveringItsAuthority(t *testing.T) {
	for _, condition := range []string{"revoked", "expired", "removed"} {
		t.Run(condition, func(t *testing.T) {
			f := newFixture(t)
			request := f.createRequest(t)
			original, err := f.service.Create(f.desktop, request)
			require.NoError(t, err)
			statement := &pb.DeviceLinkOfferStatement{}
			require.NoError(t, link.Decode(original.Offer.StatementBytes, statement))
			switch condition {
			case "revoked":
				require.NoError(t, f.database.Model(&session.SessionRecord{}).
					Where("session_id = ?", "desktop-session").Update("revoked", true).Error)
			case "expired":
				require.NoError(t, f.database.Model(&session.SessionRecord{}).
					Where("session_id = ?", "desktop-session").Update("expires_at", time.Now().Add(-time.Minute)).Error)
			case "removed":
				require.NoError(t, f.database.Where("session_id = ?", "desktop-session").Delete(&session.SessionRecord{}).Error)
			}
			// Invalid old authority must not regain a QR through exact replay.
			response, err := f.service.Create(f.desktop, request)
			require.Error(t, err)
			require.Nil(t, response)
			now := time.Now().UTC()
			key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
			certificate, signature := f.certificate(t, "new-desktop", key, 1)
			require.NoError(t, f.database.Transaction(func(tx *gorm.DB) error {
				_, err := f.service.Identity.CommitLinkedEnrollment(tx, identity.Enrollment{
					FormatVersion: 1, PTID: f.actor.PTID, ActorAccount: certificate.Device.Actor.Acct, ActorKind: 1,
					DeviceID: "new-desktop", HomeStationPeerID: f.network.station,
					ActorIdentityPublicKey: certificate.ActorIdentityPublicKey, ActorIdentityFingerprint: certificate.ActorIdentityKeyFingerprint,
					DeviceSigningPublicKey: certificate.DeviceSigningPublicKey, SigningKeyID: certificate.SigningKeyId,
					ProfileVersion: 1, CanonicalCertificateBytes: encode(t, certificate), ActorCrossSignature: signature,
				}, now)
				return err
			}))
			require.NoError(t, f.database.Create(&session.SessionRecord{
				SessionID: "relogged-session", UserID: f.actor.ID, DeviceType: session.DeviceTypeDesktop,
				StationPeerID: f.network.station, DeviceID: "new-desktop", CreatedAt: now, ExpiresAt: now.Add(time.Hour),
			}).Error)
			newLogin := coreauth.WithSubject(context.Background(), &coreauth.Subject{
				ID: f.actor.PTID, SessionID: "relogged-session",
			})
			fresh := f.createRequest(t)
			fresh.DesktopCertificate, fresh.DesktopActorCrossSignature = certificate, signature
			fresh.DeviceSignature = nil
			fresh.DeviceSignature = sign(t, fresh, key, "create")
			bad := f.createRequest(t)
			bad.DesktopCertificate, bad.DesktopActorCrossSignature = certificate, signature
			bad.DeviceSignature = nil
			bad.DeviceSignature = sign(t, bad, key, "create")
			bad.DeviceSignature[0] ^= 1
			response, err = f.service.Create(newLogin, bad)
			require.Error(t, err)
			require.Nil(t, response)
			var stored rows.Offer
			require.NoError(t, f.database.Where("id = ?", statement.OfferId).First(&stored).Error)
			require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_OPEN, stored.State)

			response, err = f.service.Create(newLogin, fresh)
			require.NoError(t, err)
			next := &pb.DeviceLinkOfferStatement{}
			require.NoError(t, link.Decode(response.Offer.StatementBytes, next))
			require.NotEqual(t, statement.OfferId, next.OfferId)
			require.NoError(t, f.database.Where("id = ?", statement.OfferId).First(&stored).Error)
			require.Equal(t, pb.DeviceLinkState_DEVICE_LINK_STATE_REVOKED, stored.State)
			require.Nil(t, stored.LiveActor)
			require.Empty(t, stored.IdentityEnvelope)
			var live rows.Offer
			require.NoError(t, f.database.Where("live_actor = ?", f.actor.PTID).First(&live).Error)
			require.Equal(t, "relogged-session", live.DesktopSessionID)
		})
	}
}
