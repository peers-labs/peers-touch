package peer

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/protobuf/proto"
)

func TestPublicConnectionMaterialAndAdvertisementRoundTrip(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000).UTC()
	rootPrivateKey, rootPublicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Station root key: %v", err)
	}
	rootPeerID, err := libp2ppeer.IDFromPublicKey(rootPublicKey)
	if err != nil {
		t.Fatalf("derive Station PeerID: %v", err)
	}
	rootPublicKeyBytes, err := libp2pcrypto.MarshalPublicKey(rootPublicKey)
	if err != nil {
		t.Fatalf("marshal Station root key: %v", err)
	}
	material := &PublicEndpointConnectionMaterial{
		SchemaVersion:                PublicConnectionMaterialSchemaVersion,
		CanonicalDiscoveryOrigin:     "https://station.example:8443",
		ExpectedEndpointRole:         AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
		ExpectedEndpointIdentity:     rootPeerID.String(),
		ExpectedStationRootPublicKey: rootPublicKeyBytes,
		EndpointTlsTrust: &EndpointTlsTrust{
			Trust: &EndpointTlsTrust_LeafSpkiSha256{
				LeafSpkiSha256: bytes.Repeat([]byte{0x35}, 32),
			},
		},
		IssuedAtUnixMs:  now.UnixMilli(),
		ExpiresAtUnixMs: now.Add(24 * time.Hour).UnixMilli(),
	}

	verified, err := VerifyPublicEndpointConnectionMaterial(material, true, now)
	if err != nil {
		t.Fatalf("verify public connection material: %v", err)
	}
	if verified.ExpectedEndpointIdentity != rootPeerID ||
		verified.TLSTrust.LeafSPKISHA256 != [32]byte{
			0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35,
			0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35,
			0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35,
			0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35, 0x35,
		} {
		t.Fatalf("unexpected verified material: %+v", verified)
	}

	advertisement, err := SignPublicStationAdvertisement(
		rootPrivateKey,
		material,
		"Public Station",
		7,
		now,
		now.Add(12*time.Hour),
	)
	if err != nil {
		t.Fatalf("sign public Station advertisement: %v", err)
	}
	verifiedAdvertisement, err := VerifyPublicStationAdvertisement(
		advertisement,
		material,
		now,
	)
	if err != nil {
		t.Fatalf("verify public Station advertisement: %v", err)
	}
	if verifiedAdvertisement.Statement.GetAdvertisementSequence() != 7 ||
		verifiedAdvertisement.Statement.GetStationPeerId() != rootPeerID.String() {
		t.Fatalf("unexpected advertisement: %+v", verifiedAdvertisement.Statement)
	}

	tampered := proto.Clone(material).(*PublicEndpointConnectionMaterial)
	tampered.CanonicalDiscoveryOrigin = "https://other.example:8443"
	if _, err := VerifyPublicStationAdvertisement(
		advertisement,
		tampered,
		now,
	); err == nil {
		t.Fatal("advertisement accepted different connection material")
	}
	advertisement.StationRootSignature[0] ^= 0xff
	if _, err := VerifyPublicStationAdvertisement(
		advertisement,
		material,
		now,
	); err == nil {
		t.Fatal("advertisement accepted a forged root signature")
	}
}

func TestPublicConnectionMaterialRejectsBareHTTPAndIdentitySubstitution(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000).UTC()
	_, relayPublicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Relay key: %v", err)
	}
	relayPeerID, err := libp2ppeer.IDFromPublicKey(relayPublicKey)
	if err != nil {
		t.Fatalf("derive Relay PeerID: %v", err)
	}
	material := &PublicEndpointConnectionMaterial{
		SchemaVersion:            PublicConnectionMaterialSchemaVersion,
		CanonicalDiscoveryOrigin: "http://192.0.2.10:8080",
		ExpectedEndpointRole:     AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ExpectedEndpointIdentity: relayPeerID.String(),
		IssuedAtUnixMs:           now.UnixMilli(),
		ExpiresAtUnixMs:          now.Add(time.Hour).UnixMilli(),
	}
	if _, err := VerifyPublicEndpointConnectionMaterial(
		material,
		false,
		now,
	); err == nil {
		t.Fatal("bare remote HTTP material was accepted")
	}
	if _, err := VerifyPublicEndpointConnectionMaterial(
		material,
		true,
		now,
	); err != nil {
		t.Fatalf("authenticated HTTP material was rejected: %v", err)
	}

	material.ExpectedEndpointIdentity = "12D3KooWnot-a-peer-id"
	if _, err := VerifyPublicEndpointConnectionMaterial(
		material,
		true,
		now,
	); err == nil {
		t.Fatal("invalid expected endpoint identity was accepted")
	}
}

func TestPublicConnectionMaterialUsesEndpointScopedCertificateAuthority(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000).UTC()
	_, relayPublicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Relay key: %v", err)
	}
	relayPeerID, err := libp2ppeer.IDFromPublicKey(relayPublicKey)
	if err != nil {
		t.Fatalf("derive Relay PeerID: %v", err)
	}
	certificatePublicKey, certificatePrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate certificate key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Endpoint Test CA"},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	certificateDER, err := x509.CreateCertificate(
		rand.Reader,
		template,
		template,
		certificatePublicKey,
		certificatePrivateKey,
	)
	if err != nil {
		t.Fatalf("create endpoint CA: %v", err)
	}
	material := &PublicEndpointConnectionMaterial{
		SchemaVersion:            PublicConnectionMaterialSchemaVersion,
		CanonicalDiscoveryOrigin: "https://relay.example:443",
		ExpectedEndpointRole:     AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ExpectedEndpointIdentity: relayPeerID.String(),
		EndpointTlsTrust: &EndpointTlsTrust{
			Trust: &EndpointTlsTrust_CertificateAuthorityDer{
				CertificateAuthorityDer: certificateDER,
			},
		},
		IssuedAtUnixMs:  now.UnixMilli(),
		ExpiresAtUnixMs: now.Add(time.Hour).UnixMilli(),
	}
	verified, err := VerifyPublicEndpointConnectionMaterial(material, true, now)
	if err != nil {
		t.Fatalf("verify endpoint CA material: %v", err)
	}
	if !bytes.Equal(verified.TLSTrust.CertificateAuthorityDER, certificateDER) {
		t.Fatal("verified endpoint CA bytes changed")
	}
}
