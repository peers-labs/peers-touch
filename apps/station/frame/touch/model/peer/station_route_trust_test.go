package peer

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"testing"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
)

func TestAccessEndpointSourceProofBindsTransportIdentityAndGrant(t *testing.T) {
	sourcePrivateKey, sourcePublicKey, err := libp2pcrypto.GenerateEd25519Key(
		rand.Reader,
	)
	if err != nil {
		t.Fatalf("generate source key: %v", err)
	}
	sourcePeerID, err := libp2ppeer.IDFromPublicKey(sourcePublicKey)
	if err != nil {
		t.Fatalf("derive source PeerID: %v", err)
	}
	_, relayPublicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Relay key: %v", err)
	}
	relayPeerID, err := libp2ppeer.IDFromPublicKey(relayPublicKey)
	if err != nil {
		t.Fatalf("derive Relay PeerID: %v", err)
	}
	grantDigest := sha256.Sum256([]byte("grant"))
	statement := &AccessEndpointSourceProofStatement{
		Challenge:             bytes.Repeat([]byte{0x31}, StationIdentityChallengeSize),
		ConnectionGrantDigest: grantDigest[:],
		RelayPeerId:           relayPeerID.String(),
		ClientProtocolVersion: 1,
	}
	proof, err := SignAccessEndpointSourceProof(sourcePrivateKey, statement)
	if err != nil {
		t.Fatalf("sign source proof: %v", err)
	}
	verified, err := VerifyAccessEndpointSourceProof(proof)
	if err != nil {
		t.Fatalf("verify source proof: %v", err)
	}
	if verified.SourcePeerID != sourcePeerID ||
		!bytes.Equal(
			verified.Statement.GetConnectionGrantDigest(),
			grantDigest[:],
		) {
		t.Fatalf("unexpected verified source proof: %+v", verified)
	}

	proof.SourceSignature[0] ^= 0xff
	if _, err := VerifyAccessEndpointSourceProof(proof); err == nil {
		t.Fatal("tampered source proof was accepted")
	}
}

func TestRouteAddressesMatchKindAcceptsOnlyExactDirectNode(t *testing.T) {
	statement := &StationRouteStatement{
		NodePeerId: "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		Kind:       StationRouteKind_STATION_ROUTE_KIND_DIRECT,
		Addresses: []string{
			"/ip4/192.0.2.20/tcp/4501/p2p/" +
				"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		},
	}

	if !routeAddressesMatchKind(statement) {
		t.Fatal("full Direct address was rejected")
	}

	statement.Addresses = []string{
		"/ip4/192.0.2.20/tcp/4501/p2p/" +
			"12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag",
	}
	if routeAddressesMatchKind(statement) {
		t.Fatal("Direct address for a different Node identity was accepted")
	}
}

func TestRouteAddressesMatchKindRequiresDialableCircuitPrefix(t *testing.T) {
	statement := &StationRouteStatement{
		NodePeerId:  "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		RelayPeerId: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		Kind:        StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses: []string{
			"/ip4/192.0.2.20/tcp/4501/p2p/" +
				"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW" +
				"/p2p-circuit/p2p/" +
				"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		},
	}

	if !routeAddressesMatchKind(statement) {
		t.Fatal("full Circuit address was rejected")
	}

	statement.Addresses = []string{
		"/p2p/" + statement.RelayPeerId +
			"/p2p-circuit/p2p/" + statement.NodePeerId,
	}
	if routeAddressesMatchKind(statement) {
		t.Fatal("Circuit address without a Relay dial prefix was accepted")
	}
}

func TestRouteAddressesMatchKindRejectsCircuitIdentityMismatch(t *testing.T) {
	statement := &StationRouteStatement{
		NodePeerId:  "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		RelayPeerId: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		Kind:        StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses: []string{
			"/ip4/192.0.2.20/tcp/4501/p2p/" +
				"12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag" +
				"/p2p-circuit/p2p/" +
				"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		},
	}

	if routeAddressesMatchKind(statement) {
		t.Fatal("Circuit address for a different Relay identity was accepted")
	}
}
