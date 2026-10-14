package relay

import (
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestAdmissionFailsClosedAndDoesNotPreConsumePrivatePermit(t *testing.T) {
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
		PermitID:          "permit-a",
		SourcePeerID:      source,
		DestinationPeerID: destination,
		Generation:        7,
		ExpiresAt:         now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("install permit: %v", err)
	}
	if !admission.AllowConnect(source, nil, destination) {
		t.Fatal("valid private permit was rejected")
	}
	if !admission.AllowConnect(source, nil, destination) {
		t.Fatal("ACL check consumed the permit before Circuit admission")
	}
	now = now.Add(2 * time.Minute)
	if admission.AllowConnect(source, nil, destination) {
		t.Fatal("expired private permit remained active")
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

func TestAdmissionGenerationReplacementClearsRouteAndPrivatePermits(
	t *testing.T,
) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	admission := NewAdmission()
	admission.now = func() time.Time { return now }
	destination := testPeerID(t)
	permittedSource := testPeerID(t)
	ordinarySource := testPeerID(t)

	if err := admission.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    1,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("admit generation one: %v", err)
	}
	if err := admission.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 1,
		Public:     false,
		ExpiresAt:  now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish generation-one route: %v", err)
	}
	if err := admission.Permit(ConnectPermit{
		PermitID:          "generation-one",
		SourcePeerID:      permittedSource,
		DestinationPeerID: destination,
		Generation:        1,
		ExpiresAt:         now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("install generation-one permit: %v", err)
	}
	if admission.AllowConnect(ordinarySource, nil, destination) {
		t.Fatal("private permit was not bound to its source PeerID")
	}

	if err := admission.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    2,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("replace node generation: %v", err)
	}
	if nodes, routes, permits := admission.Counts(); nodes != 1 ||
		routes != 0 || permits != 0 {
		t.Fatalf(
			"replacement retained stale state: nodes=%d routes=%d permits=%d",
			nodes,
			routes,
			permits,
		)
	}
	if admission.AllowConnect(permittedSource, nil, destination) {
		t.Fatal("generation replacement retained the old route or permit")
	}
	if err := admission.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 1,
		Public:     true,
		ExpiresAt:  now.Add(time.Minute),
	}); err == nil {
		t.Fatal("stale generation republished a route")
	}
	if err := admission.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 2,
		Public:     true,
		ExpiresAt:  now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish replacement route: %v", err)
	}
	if !admission.AllowConnect(ordinarySource, nil, destination) {
		t.Fatal("ordinary source could not reach a public admitted destination")
	}
}

func TestAdmissionRestartDoesNotRestorePrivatePermit(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	destination := testPeerID(t)
	source := testPeerID(t)

	admission := NewAdmission()
	admission.now = func() time.Time { return now }
	if err := admission.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    4,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("admit node: %v", err)
	}
	if err := admission.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 4,
		Public:     false,
		ExpiresAt:  now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish private route: %v", err)
	}
	if err := admission.Permit(ConnectPermit{
		PermitID:          "restart-private",
		SourcePeerID:      source,
		DestinationPeerID: destination,
		Generation:        4,
		ExpiresAt:         now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("install private permit: %v", err)
	}
	if !admission.AllowConnect(source, nil, destination) {
		t.Fatal("valid private permit was rejected")
	}

	restarted := NewAdmission()
	restarted.now = func() time.Time { return now }
	if err := restarted.AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destination,
		Generation:    4,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("rehydrate node after restart: %v", err)
	}
	if err := restarted.PublishRoute(RouteAdmission{
		NodePeerID: destination,
		Generation: 4,
		Public:     false,
		ExpiresAt:  now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("republish private route after restart: %v", err)
	}
	if restarted.AllowConnect(source, nil, destination) {
		t.Fatal("volatile private permit was restored after restart")
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
