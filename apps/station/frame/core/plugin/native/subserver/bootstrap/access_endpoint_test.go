package bootstrap

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

func TestSignAccessEndpointBindsChallengeRoleAndIdentity(t *testing.T) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	challenge := bytes.Repeat([]byte{0x42}, stationIdentityChallengeSize)
	now := time.Unix(1_800_000_000, 0).UTC()
	response, err := signAccessEndpoint(
		privateKey,
		stationPeerID,
		"https://station.example:443",
		&peerpb.AccessEndpointRequest{
			Challenge:             challenge,
			ClientProtocolVersion: accessProtocolVersion,
		},
		now,
	)
	if err != nil {
		t.Fatalf("sign access endpoint: %v", err)
	}
	statement := &peerpb.AccessEndpointStatement{}
	if err := proto.Unmarshal(
		response.GetEndpointStatementBytes(),
		statement,
	); err != nil {
		t.Fatalf("decode endpoint statement: %v", err)
	}
	if statement.GetEndpointRole() !=
		peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION {
		t.Fatalf("unexpected endpoint role: %s", statement.GetEndpointRole())
	}
	if statement.GetEndpointPeerId() != stationPeerID.String() {
		t.Fatalf("unexpected endpoint peer ID: %s", statement.GetEndpointPeerId())
	}
	if !bytes.Equal(statement.GetChallenge(), challenge) {
		t.Fatal("endpoint statement did not bind the client challenge")
	}
	ok, err := publicKey.Verify(
		append(
			[]byte(accessEndpointDomain),
			response.GetEndpointStatementBytes()...,
		),
		response.GetEndpointSignature(),
	)
	if err != nil || !ok {
		t.Fatalf("verify endpoint signature: ok=%v err=%v", ok, err)
	}
}

func TestSignAccessEndpointRejectsGrantAndUnsupportedVersion(t *testing.T) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	challenge := bytes.Repeat([]byte{0x21}, stationIdentityChallengeSize)
	tests := []peerpb.AccessEndpointRequest{
		{
			Challenge:             challenge,
			ClientProtocolVersion: accessProtocolVersion + 1,
		},
		{
			Challenge:             challenge,
			ConnectionGrant:       []byte("private"),
			ClientProtocolVersion: accessProtocolVersion,
		},
	}
	for index := range tests {
		if _, err := signAccessEndpoint(
			privateKey,
			stationPeerID,
			"https://station.example:443",
			&tests[index],
			time.Now().UTC(),
		); err == nil {
			t.Fatalf("case %d unexpectedly succeeded", index)
		}
	}
}

func TestStationSignsRouteAndConnectionGrantWithHostKey(t *testing.T) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	routeStatement := &peerpb.StationRouteStatement{
		StationPeerId:      stationPeerID.String(),
		RelayPeerId:        "relay-peer",
		RouteId:            "route-1",
		RouteGeneration:    3,
		InnerTlsSpkiSha256: bytes.Repeat([]byte{0x11}, sha256.Size),
		CapabilitiesDigest: bytes.Repeat([]byte{0x22}, sha256.Size),
		Visibility:         peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
		IssuedAtUnixMs:     now.UnixMilli(),
		ExpiresAtUnixMs:    now.Add(time.Hour).UnixMilli(),
	}
	route, err := signStationRouteAttestation(
		privateKey,
		stationPeerID,
		routeStatement,
		now,
	)
	if err != nil {
		t.Fatalf("sign route attestation: %v", err)
	}
	ok, err := publicKey.Verify(
		append(
			[]byte("peers-touch/station-route/v1\x00"),
			route.GetStatementBytes()...,
		),
		route.GetSignature(),
	)
	if err != nil || !ok {
		t.Fatalf("verify route attestation: ok=%v err=%v", ok, err)
	}

	grantStatement := &peerpb.StationConnectionGrantStatement{
		GrantId:         "grant-1",
		StationPeerId:   stationPeerID.String(),
		RelayPeerId:     "relay-peer",
		RouteId:         "route-1",
		RouteGeneration: 3,
		MaxUses:         1,
		IssuedAtUnixMs:  now.UnixMilli(),
		ExpiresAtUnixMs: now.Add(time.Minute).UnixMilli(),
	}
	grant, err := signStationConnectionGrant(
		privateKey,
		stationPeerID,
		grantStatement,
		now,
	)
	if err != nil {
		t.Fatalf("sign connection grant: %v", err)
	}
	ok, err = publicKey.Verify(
		append(
			[]byte("peers-touch/station-connection-grant/v1\x00"),
			grant.GetStatementBytes()...,
		),
		grant.GetSignature(),
	)
	if err != nil || !ok {
		t.Fatalf("verify connection grant: ok=%v err=%v", ok, err)
	}
}
