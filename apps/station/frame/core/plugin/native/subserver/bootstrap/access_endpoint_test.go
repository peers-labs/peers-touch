package bootstrap

import (
	"bytes"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

func TestSignAccessEndpointBindsAuthorizedNode(t *testing.T) {
	fixture := newStationIdentityFixture(t)
	nodePeerID, err := peer.IDFromPrivateKey(fixture.nodeKey)
	if err != nil {
		t.Fatalf("derive node PeerID: %v", err)
	}
	challenge := bytes.Repeat(
		[]byte{0x42},
		peerpb.StationIdentityChallengeSize,
	)
	response, err := signAccessEndpoint(
		fixture.nodeKey,
		nodePeerID,
		fixture.authorization,
		"https://station.example:443",
		&peerpb.AccessEndpointRequest{
			Challenge:             challenge,
			ClientProtocolVersion: accessProtocolVersion,
		},
		fixture.now,
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
	if statement.GetEndpointPeerId() != nodePeerID.String() {
		t.Fatalf("endpoint PeerID = %s, want node %s", statement.GetEndpointPeerId(), nodePeerID)
	}
	if !bytes.Equal(statement.GetChallenge(), challenge) {
		t.Fatal("endpoint statement did not bind the client challenge")
	}
	authorization, err := peerpb.VerifyStationNodeAuthorization(
		response.GetNodeAuthorization(),
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify endpoint node authorization: %v", err)
	}
	if !bytes.Equal(
		statement.GetNodeAuthorizationDigest(),
		authorization.Digest[:],
	) {
		t.Fatal("endpoint statement did not bind its node authorization")
	}
	ok, err := fixture.nodeKey.GetPublic().Verify(
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

func TestSignAccessEndpointRejectsGrantUnsupportedVersionAndWrongNode(
	t *testing.T,
) {
	fixture := newStationIdentityFixture(t)
	nodePeerID, err := peer.IDFromPrivateKey(fixture.nodeKey)
	if err != nil {
		t.Fatalf("derive node PeerID: %v", err)
	}
	challenge := bytes.Repeat(
		[]byte{0x21},
		peerpb.StationIdentityChallengeSize,
	)
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
			fixture.nodeKey,
			nodePeerID,
			fixture.authorization,
			"https://station.example:443",
			&tests[index],
			fixture.now,
		); err == nil {
			t.Fatalf("case %d unexpectedly succeeded", index)
		}
	}
	if _, err := signAccessEndpoint(
		fixture.nodeKey,
		peer.ID("wrong-node"),
		fixture.authorization,
		"https://station.example:443",
		&peerpb.AccessEndpointRequest{
			Challenge:             challenge,
			ClientProtocolVersion: accessProtocolVersion,
		},
		fixture.now,
	); err == nil {
		t.Fatal("endpoint signer accepted a mismatched node PeerID")
	}
}

func TestStationRouteAndGrantBindRootNodeRelayAndTLS(t *testing.T) {
	fixture := newStationIdentityFixture(t)
	authorization, err := peerpb.VerifyStationNodeAuthorization(
		fixture.authorization,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify node authorization: %v", err)
	}
	routeStatement := &peerpb.StationRouteStatement{
		StationPeerId:           authorization.Statement.GetStationPeerId(),
		RelayPeerId:             "relay-peer",
		RouteId:                 "route-1",
		RouteGeneration:         3,
		InnerTlsSpkiSha256:      bytes.Repeat([]byte{0x11}, sha256.Size),
		CapabilitiesDigest:      append([]byte(nil), authorization.Statement.GetCapabilitiesDigest()...),
		Visibility:              peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
		IssuedAtUnixMs:          fixture.now.UnixMilli(),
		ExpiresAtUnixMs:         fixture.now.Add(peerpb.MaxRouteAttestationLifetime).UnixMilli(),
		NodePeerId:              authorization.Statement.GetNodePeerId(),
		NodeAuthorizationDigest: authorization.Digest[:],
		Kind:                    peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses:               []string{"/p2p/relay-peer/p2p-circuit/p2p/" + authorization.Statement.GetNodePeerId()},
	}
	route, err := peerpb.SignStationRouteAttestation(
		fixture.nodeKey,
		fixture.authorization,
		routeStatement,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("sign route attestation: %v", err)
	}
	verifiedRoute, err := peerpb.VerifyStationRouteAttestation(
		route,
		"relay-peer",
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify route attestation: %v", err)
	}
	if verifiedRoute.Statement.GetStationPeerId() ==
		verifiedRoute.Statement.GetNodePeerId() {
		t.Fatal("route collapsed logical Station and node identity")
	}

	grantStatement := &peerpb.StationConnectionGrantStatement{
		GrantId:                 "grant-1",
		StationPeerId:           authorization.Statement.GetStationPeerId(),
		RelayPeerId:             "relay-peer",
		RouteId:                 "route-1",
		RouteGeneration:         3,
		MaxUses:                 1,
		IssuedAtUnixMs:          fixture.now.UnixMilli(),
		ExpiresAtUnixMs:         fixture.now.Add(time.Minute).UnixMilli(),
		NodePeerId:              authorization.Statement.GetNodePeerId(),
		NodeAuthorizationDigest: authorization.Digest[:],
	}
	grant, err := peerpb.SignStationConnectionGrant(
		fixture.nodeKey,
		fixture.authorization,
		grantStatement,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("sign connection grant: %v", err)
	}
	if _, err := peerpb.VerifyStationConnectionGrant(
		grant,
		fixture.now,
	); err != nil {
		t.Fatalf("verify connection grant: %v", err)
	}
}

func TestStationRouteRejectsRelaySPKIAndAuthorizationSubstitution(
	t *testing.T,
) {
	fixture := newStationIdentityFixture(t)
	authorization, err := peerpb.VerifyStationNodeAuthorization(
		fixture.authorization,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify node authorization: %v", err)
	}
	statement := &peerpb.StationRouteStatement{
		StationPeerId:           authorization.Statement.GetStationPeerId(),
		RelayPeerId:             "relay-peer",
		RouteId:                 "route-1",
		RouteGeneration:         1,
		InnerTlsSpkiSha256:      bytes.Repeat([]byte{1}, sha256.Size),
		CapabilitiesDigest:      append([]byte(nil), authorization.Statement.GetCapabilitiesDigest()...),
		Visibility:              peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
		IssuedAtUnixMs:          fixture.now.UnixMilli(),
		ExpiresAtUnixMs:         fixture.now.Add(time.Minute).UnixMilli(),
		NodePeerId:              authorization.Statement.GetNodePeerId(),
		NodeAuthorizationDigest: authorization.Digest[:],
		Kind:                    peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses:               []string{"/p2p/relay-peer/p2p-circuit/p2p/" + authorization.Statement.GetNodePeerId()},
	}
	route, err := peerpb.SignStationRouteAttestation(
		fixture.nodeKey,
		fixture.authorization,
		statement,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("sign route: %v", err)
	}
	if _, err := peerpb.VerifyStationRouteAttestation(
		route,
		"other-relay",
		fixture.now,
	); err == nil {
		t.Fatal("route was accepted for another Relay")
	}

	tamperedStatement := proto.Clone(statement).(*peerpb.StationRouteStatement)
	tamperedStatement.InnerTlsSpkiSha256[0] ^= 0xff
	route.StatementBytes, _ = proto.MarshalOptions{Deterministic: true}.
		Marshal(tamperedStatement)
	if _, err := peerpb.VerifyStationRouteAttestation(
		route,
		"relay-peer",
		fixture.now,
	); err == nil {
		t.Fatal("route with substituted TLS SPKI was accepted")
	}

	other := newStationIdentityFixture(t)
	route.NodeAuthorization = other.authorization
	if _, err := peerpb.VerifyStationRouteAttestation(
		route,
		"relay-peer",
		fixture.now,
	); err == nil {
		t.Fatal("route with substituted node authorization was accepted")
	}
}
