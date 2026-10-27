package application_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
	"time"

	"github.com/cloudflare/circl/hpke"
	"github.com/google/uuid"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	identitydb "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/application"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	linkdb "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type fixtureNetwork struct {
	node      crypto.PrivKey
	authority *peerpb.StationNodeAuthorization
	station   string
}

func (n fixtureNetwork) Prepare(_ context.Context, expires time.Time, _ uint32) (*link.NetworkBundle, error) {
	direct := &peerpb.PublicEndpointConnectionMaterial{SchemaVersion: 1,
		CanonicalDiscoveryOrigin: "https://station.example.test", ExpectedEndpointRole: peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
		ExpectedEndpointIdentity: n.station, ExpectedStationRootPublicKey: n.authority.StationRootPublicKey,
		IssuedAtUnixMs: expires.Add(-5 * time.Minute).UnixMilli(), ExpiresAtUnixMs: expires.UnixMilli()}
	return &link.NetworkBundle{StationPeerID: n.station, Root: n.authority.StationRootPublicKey,
		Connections: []*pb.DeviceLinkConnectionCandidate{{Material: &pb.DeviceLinkConnectionCandidate_Direct{Direct: direct}}}, Retrieval: direct}, nil
}
func (n fixtureNetwork) SignNetworkMaterial(_ context.Context, purpose string, raw []byte) ([]byte, *peerpb.StationNodeAuthorization, error) {
	signature, err := n.node.Sign(append([]byte(purpose), raw...))
	return signature, n.authority, err
}
func (n fixtureNetwork) Publish(_ context.Context, request *peerpb.PublishBootstrapBlobRequest) error {
	_, err := peerpb.VerifyBootstrapBlob(request, time.Now())
	return err
}

type fixture struct {
	service                     *application.Service
	database                    *gorm.DB
	actor                       *db.Actor
	identityKey                 ed25519.PrivateKey
	desktopKey                  ed25519.PrivateKey
	desktopCertificate          *model.ActorDeviceCertificate
	desktopCertificateSignature []byte
	desktop                     context.Context
	network                     fixtureNetwork
}

func encode(t *testing.T, message proto.Message) []byte {
	t.Helper()
	raw, err := link.Encode(message)
	require.NoError(t, err)
	return raw
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, database.AutoMigrate(&db.Actor{}, &db.AccessPolicy{}, &db.AccessAttempt{}, &db.AccessGateSubmission{}, &session.SessionRecord{}))
	require.NoError(t, session.NewDBStore(func(context.Context) (*gorm.DB, error) {
		return database, nil
	}, 0).AutoMigrate(context.Background()))
	require.NoError(t, linkdb.Migrate(database))
	keyMaterial, err := link.Random(32)
	require.NoError(t, err)
	_, err = coreauth.OpenStationAccessKeyring(context.Background(), database, hex.EncodeToString(keyMaterial), "")
	require.NoError(t, err)
	owner, err := identitydb.NewRepository(database)
	require.NoError(t, err)
	require.NoError(t, owner.AutoMigrate())
	require.NoError(t, database.Create(&db.AccessPolicy{Mode: "open"}).Error)
	_, identityKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	_, desktopKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	root, _, err := crypto.GenerateEd25519Key(rand.Reader)
	require.NoError(t, err)
	node, _, err := crypto.GenerateEd25519Key(rand.Reader)
	require.NoError(t, err)
	now := time.Now().UTC()
	authority, err := peerpb.SignDefaultStationNodeAuthorization(root, node.GetPublic(), []string{"access-gate", "endpoint-discovery"}, now)
	require.NoError(t, err)
	verified, err := peerpb.VerifyStationNodeAuthorization(authority, now)
	require.NoError(t, err)
	previous := federation.LocalIdentitySnapshot().StationPeerID
	stationID, err := peer.Decode(verified.Statement.StationPeerId)
	require.NoError(t, err)
	federation.SetLocalStationPeerID(stationID)
	t.Cleanup(func() { federation.SetLocalStationPeerID(previous) })
	actor := &db.Actor{ID: 1, PTID: "ptid:v1:actor:peers:p:bob:1220d112c4e53405d2df5b04355bc8cbde006d6f11db84bba1414bddd0d98ca55d2f",
		Kind: "p", PreferredUsername: "bob", Email: "bob@example.test", FederatedHandle: "@bob@example.test",
		HomeStationPeerID: verified.Statement.StationPeerId}
	require.NoError(t, database.Create(actor).Error)
	f := &fixture{database: database, actor: actor, identityKey: identityKey, desktopKey: desktopKey,
		network: fixtureNetwork{node: node, authority: authority, station: verified.Statement.StationPeerId}}
	certificate, signature := f.certificate(t, "desktop", desktopKey, 1)
	f.desktopCertificate, f.desktopCertificateSignature = certificate, signature
	require.NoError(t, database.Create(&identitydb.ActorIdentityModel{PTID: actor.PTID,
		PublicKey: identityKey.Public().(ed25519.PublicKey), Fingerprint: link.Digest(identityKey.Public().(ed25519.PublicKey)),
		ProfileVersion: 1, CreatedAt: now, UpdatedAt: now}).Error)
	require.NoError(t, database.Transaction(func(tx *gorm.DB) error {
		raw := encode(t, certificate)
		_, err := owner.CommitLinkedEnrollment(tx, identity.Enrollment{
			FormatVersion: 1, PTID: actor.PTID, ActorAccount: certificate.Device.Actor.Acct, ActorKind: 1, DeviceID: "desktop",
			HomeStationPeerID: f.network.station, ActorIdentityPublicKey: certificate.ActorIdentityPublicKey,
			ActorIdentityFingerprint: certificate.ActorIdentityKeyFingerprint, DeviceSigningPublicKey: certificate.DeviceSigningPublicKey,
			SigningKeyID: certificate.SigningKeyId, ProfileVersion: 1, CanonicalCertificateBytes: raw, ActorCrossSignature: signature,
		}, now)
		return err
	}))
	require.NoError(t, database.Create(&session.SessionRecord{SessionID: "desktop-session", UserID: 1, DeviceType: session.DeviceTypeDesktop,
		StationPeerID: f.network.station, DeviceID: "desktop", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}).Error)
	f.desktop = coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: actor.PTID, SessionID: "desktop-session"})
	f.service = &application.Service{Database: func(context.Context) (*gorm.DB, error) { return database, nil },
		Identity: owner, Network: f.network, Clock: time.Now}
	return f
}

func (f *fixture) certificate(t *testing.T, deviceID string, deviceKey ed25519.PrivateKey, revision uint64) (*model.ActorDeviceCertificate, []byte) {
	public := deviceKey.Public().(ed25519.PublicKey)
	certificate := &model.ActorDeviceCertificate{FormatVersion: 1, Device: &model.ActorDeviceRef{Actor: touchactor.ProtoActorRef(f.actor), DeviceId: deviceID},
		ActorIdentityPublicKey: f.identityKey.Public().(ed25519.PublicKey), ActorIdentityKeyFingerprint: link.Digest(f.identityKey.Public().(ed25519.PublicKey)),
		DeviceSigningPublicKey: public, SigningKeyId: hex.EncodeToString(link.Digest(public)), ObservedProfileVersion: revision}
	return certificate, ed25519.Sign(f.identityKey, encode(t, certificate))
}

func sign(t *testing.T, message proto.Message, key ed25519.PrivateKey, purpose string) []byte {
	t.Helper()
	return ed25519.Sign(key, append([]byte("peers-touch/device-link/"+purpose+"/v1\x00"), encode(t, message)...))
}

func (f *fixture) create(t *testing.T) *pb.CreateDeviceLinkResponse {
	public, _, err := hpke.KEM_X25519_HKDF_SHA256.Scheme().GenerateKeyPair()
	require.NoError(t, err)
	hpkePublic, err := public.MarshalBinary()
	require.NoError(t, err)
	request := &pb.CreateDeviceLinkRequest{RequestId: uuid.NewString(), DesktopHpkePublicKey: hpkePublic,
		DesktopCertificate: f.desktopCertificate, DesktopActorCrossSignature: f.desktopCertificateSignature}
	request.DeviceSignature = sign(t, request, f.desktopKey, "create")
	response, err := f.service.Create(f.desktop, request)
	require.NoError(t, err)
	retry, err := f.service.Create(f.desktop, request)
	require.NoError(t, err)
	require.True(t, proto.Equal(response, retry))
	return response
}

type phone struct {
	key        ed25519.PrivateKey
	hpkePublic []byte
	claim      *pb.ClaimDeviceLinkResponse
	offerID    string
	request    *pb.ClaimDeviceLinkRequest
}

func (f *fixture) claim(t *testing.T, offer *pb.CreateDeviceLinkResponse) *phone {
	public, _, err := hpke.KEM_X25519_HKDF_SHA256.Scheme().GenerateKeyPair()
	require.NoError(t, err)
	hpkePublic, err := public.MarshalBinary()
	require.NoError(t, err)
	_, key, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	offerStatement := &pb.DeviceLinkOfferStatement{}
	require.NoError(t, link.Decode(offer.Offer.StatementBytes, offerStatement))
	nonce, err := link.Random(32)
	require.NoError(t, err)
	statement := &pb.DeviceLinkClaimStatement{ProtocolVersion: 1, OfferId: offerStatement.OfferId, RequestId: uuid.NewString(),
		StationPeerId: f.network.station, MobileDeviceId: uuid.NewString(), Platform: "ios", DeviceLabel: "Phone",
		MobileHpkePublicKey: hpkePublic, MobileDeviceSigningPublicKey: key.Public().(ed25519.PublicKey),
		ClaimNonce: nonce, LifecycleGeneration: 1, TransportSourcePublicKey: key.Public().(ed25519.PublicKey)}
	raw := encode(t, statement)
	request := &pb.ClaimDeviceLinkRequest{OfferId: statement.OfferId, ScanCapability: offerStatement.ScanCapability,
		StatementBytes: raw, DeviceSignature: ed25519.Sign(key, append([]byte(link.ClaimDomain), raw...))}
	response, err := f.service.Claim(context.Background(), request)
	require.NoError(t, err)
	retry, err := f.service.Claim(context.Background(), request)
	require.NoError(t, err)
	require.True(t, proto.Equal(response, retry))
	return &phone{key: key, hpkePublic: hpkePublic, claim: response, offerID: statement.OfferId, request: request}
}

func (p *phone) authorization() *pb.DeviceLinkClaimAuthorization {
	return &pb.DeviceLinkClaimAuthorization{OfferId: p.offerID, ClaimId: p.claim.Claim.ClaimId, ClaimCapability: p.claim.ClaimCapability}
}
