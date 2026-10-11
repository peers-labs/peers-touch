package relay

import (
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestAdmissionFailsClosedAndConsumesPrivatePermit(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	admission := NewAdmission()
	admission.now = func() time.Time { return now }
	destination := testPeerID(t)
	source := testPeerID(t)

	if admission.AllowReserve(destination, nil) {
		t.Fatal("unknown destination was allowed to reserve")
	}
	if err := admission.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    7,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("admit node: %v", err)
	}
	if !admission.AllowReserve(destination, nil) {
		t.Fatal("admitted destination could not reserve")
	}
	if err := admission.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 7,
		Public:     false,
		ExpiresAt:  now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish route: %v", err)
	}
	if admission.AllowConnect(source, nil, destination) {
		t.Fatal("private destination accepted a connection without a permit")
	}
	if err := admission.Permit(ConnectPermit{
		SourcePeerID:      source,
		DestinationPeerID: destination,
		Generation:        7,
		RemainingUses:     1,
		ExpiresAt:         now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("install permit: %v", err)
	}
	if !admission.AllowConnect(source, nil, destination) {
		t.Fatal("valid private permit was rejected")
	}
	if admission.AllowConnect(source, nil, destination) {
		t.Fatal("consumed private permit was replayed")
	}
}

func TestAdmissionRenewalPreservesRouteAndRevocationFailsClosed(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	admission := NewAdmission()
	admission.now = func() time.Time { return now }
	destination := testPeerID(t)
	source := testPeerID(t)

	if err := admission.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    2,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("admit node: %v", err)
	}
	if err := admission.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 2,
		Public:     true,
		ExpiresAt:  now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish route: %v", err)
	}
	if err := admission.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    2,
		ExpiresAt:     now.Add(2 * time.Hour),
	}); err != nil {
		t.Fatalf("renew node admission: %v", err)
	}
	if !admission.AllowConnect(source, nil, destination) {
		t.Fatal("same-generation renewal dropped the healthy public route")
	}
	if err := admission.RevokeNode(destination); err != nil {
		t.Fatalf("revoke node: %v", err)
	}
	if admission.AllowReserve(destination, nil) ||
		admission.AllowConnect(source, nil, destination) {
		t.Fatal("revoked destination remained admitted")
	}
}

func testPeerID(t *testing.T) peer.ID {
	t.Helper()
	_, publicKey, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatalf("generate PeerID key: %v", err)
	}
	id, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive PeerID: %v", err)
	}
	return id
}
