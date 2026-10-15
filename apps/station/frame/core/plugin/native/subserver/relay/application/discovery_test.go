package application

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

type discoveryTestRepository struct {
	domain.Repository
	enrollment domain.Enrollment
}

func (r *discoveryTestRepository) GetEnrollment(
	_ context.Context,
	stationPeerID string,
	nodePeerID string,
) (*domain.Enrollment, error) {
	if stationPeerID != r.enrollment.StationPeerID ||
		nodePeerID != r.enrollment.NodePeerID {
		return nil, domain.ErrEnrollmentNotFound
	}
	enrollment := r.enrollment
	return &enrollment, nil
}

type privateDiscoveryFixture struct {
	service       *Service
	admission     *nativeRelay.Admission
	grantBytes    []byte
	grantDigest   string
	destinationID peer.ID
	now           time.Time
}

func TestPrivateGrantRedemptionRequiresProofAndRetriesIdempotently(
	t *testing.T,
) {
	fixture := newPrivateDiscoveryFixture(t)
	sourceA := sourcePrivateKey(t)
	sourceAPeerID, err := peer.IDFromPrivateKey(sourceA)
	if err != nil {
		t.Fatalf("derive source A PeerID: %v", err)
	}
	sourceB := sourcePrivateKey(t)
	sourceBPeerID, err := peer.IDFromPrivateKey(sourceB)
	if err != nil {
		t.Fatalf("derive source B PeerID: %v", err)
	}

	wrongChallenge := bytes.Repeat(
		[]byte{0x71},
		domain.DiscoveryChallengeSize,
	)
	requestChallenge := bytes.Repeat(
		[]byte{0x72},
		domain.DiscoveryChallengeSize,
	)
	invalidProof := sourceProof(
		t,
		sourceA,
		wrongChallenge,
		fixture.grantBytes,
		fixture.service.authority.RelayPeerID(),
	)
	invalid := discoverPrivate(
		t,
		fixture,
		requestChallenge,
		invalidProof,
	)
	if invalid.GetOutcome() !=
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_SOURCE_PROOF_INVALID {
		t.Fatalf("invalid proof outcome = %s", invalid.GetOutcome())
	}
	if fixture.service.grants[fixture.grantDigest].RemainingUses != 1 {
		t.Fatal("invalid source proof consumed a grant use")
	}
	if _, _, permits := fixture.admission.Counts(); permits != 0 {
		t.Fatalf("invalid source proof created %d permits", permits)
	}

	firstProof := sourceProof(
		t,
		sourceA,
		requestChallenge,
		fixture.grantBytes,
		fixture.service.authority.RelayPeerID(),
	)
	first := discoverPrivate(t, fixture, requestChallenge, firstProof)
	if first.GetOutcome() !=
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY ||
		len(first.GetStationRoutes()) != 1 {
		t.Fatalf("first redemption = %s routes=%d", first.GetOutcome(), len(first.GetStationRoutes()))
	}
	if fixture.service.grants[fixture.grantDigest].RemainingUses != 0 {
		t.Fatal("successful redemption did not consume exactly one grant use")
	}
	if !fixture.admission.AllowConnect(
		sourceAPeerID,
		nil,
		fixture.destinationID,
	) {
		t.Fatal("redeemed source did not receive a private permit")
	}

	retryChallenge := bytes.Repeat(
		[]byte{0x73},
		domain.DiscoveryChallengeSize,
	)
	retry := discoverPrivate(
		t,
		fixture,
		retryChallenge,
		sourceProof(
			t,
			sourceA,
			retryChallenge,
			fixture.grantBytes,
			fixture.service.authority.RelayPeerID(),
		),
	)
	if retry.GetOutcome() !=
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY {
		t.Fatalf("idempotent retry outcome = %s", retry.GetOutcome())
	}
	if fixture.service.grants[fixture.grantDigest].RemainingUses != 0 {
		t.Fatal("idempotent retry consumed another grant use")
	}
	if _, _, permits := fixture.admission.Counts(); permits != 1 {
		t.Fatalf("idempotent retry created %d permits, want 1", permits)
	}

	otherChallenge := bytes.Repeat(
		[]byte{0x74},
		domain.DiscoveryChallengeSize,
	)
	other := discoverPrivate(
		t,
		fixture,
		otherChallenge,
		sourceProof(
			t,
			sourceB,
			otherChallenge,
			fixture.grantBytes,
			fixture.service.authority.RelayPeerID(),
		),
	)
	if other.GetOutcome() !=
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_REPLAYED {
		t.Fatalf("second source outcome = %s", other.GetOutcome())
	}
	if fixture.admission.AllowConnect(
		sourceBPeerID,
		nil,
		fixture.destinationID,
	) {
		t.Fatal("exhausted grant authorized a second source")
	}
}

func newPrivateDiscoveryFixture(t *testing.T) privateDiscoveryFixture {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Millisecond)
	authority, err := NewCredentialAuthority(
		bytes.Repeat([]byte{0x41}, 32),
	)
	if err != nil {
		t.Fatalf("create Relay authority: %v", err)
	}
	rootPrivateKey, rootPublicKey, err := libp2pcrypto.GenerateEd25519Key(
		rand.Reader,
	)
	if err != nil {
		t.Fatalf("generate Station root key: %v", err)
	}
	nodePrivateKey, nodePublicKey, err := libp2pcrypto.GenerateEd25519Key(
		rand.Reader,
	)
	if err != nil {
		t.Fatalf("generate Station node key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(rootPublicKey)
	if err != nil {
		t.Fatalf("derive Station PeerID: %v", err)
	}
	nodePeerID, err := peer.IDFromPublicKey(nodePublicKey)
	if err != nil {
		t.Fatalf("derive Node PeerID: %v", err)
	}
	capabilities := []string{"station-route"}
	authorization, err := peerpb.SignStationNodeAuthorization(
		rootPrivateKey,
		nodePublicKey,
		9,
		capabilities,
		now,
		now.Add(time.Hour),
	)
	if err != nil {
		t.Fatalf("sign Node authorization: %v", err)
	}
	verifiedAuthorization, err := peerpb.VerifyStationNodeAuthorization(
		authorization,
		now,
	)
	if err != nil {
		t.Fatalf("verify Node authorization: %v", err)
	}
	routeExpiresAt := now.Add(5 * time.Minute)
	routeStatement := &peerpb.StationRouteStatement{
		StationPeerId:      stationPeerID.String(),
		RelayPeerId:        authority.RelayPeerID(),
		RouteId:            "private-route",
		RouteGeneration:    9,
		InnerTlsSpkiSha256: bytes.Repeat([]byte{0x52}, sha256.Size),
		CapabilitiesDigest: verifiedAuthorization.Statement.GetCapabilitiesDigest(),
		Visibility: peerpb.
			StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
		IssuedAtUnixMs:          now.UnixMilli(),
		ExpiresAtUnixMs:         routeExpiresAt.UnixMilli(),
		NodePeerId:              nodePeerID.String(),
		NodeAuthorizationDigest: verifiedAuthorization.Digest[:],
		Kind:                    peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses: []string{
			"/ip4/127.0.0.1/tcp/4001/p2p/" + authority.RelayPeerID() +
				"/p2p-circuit/p2p/" + nodePeerID.String(),
		},
	}
	routeAttestation, err := peerpb.SignStationRouteAttestation(
		nodePrivateKey,
		authorization,
		routeStatement,
		now,
	)
	if err != nil {
		t.Fatalf("sign private route: %v", err)
	}
	routeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		routeAttestation,
	)
	if err != nil {
		t.Fatalf("marshal private route: %v", err)
	}
	grantExpiresAt := now.Add(4 * time.Minute)
	grant, err := peerpb.SignStationConnectionGrant(
		nodePrivateKey,
		authorization,
		&peerpb.StationConnectionGrantStatement{
			GrantId:                 "grant-a",
			StationPeerId:           stationPeerID.String(),
			RelayPeerId:             authority.RelayPeerID(),
			RouteId:                 routeStatement.GetRouteId(),
			RouteGeneration:         routeStatement.GetRouteGeneration(),
			MaxUses:                 1,
			IssuedAtUnixMs:          now.UnixMilli(),
			ExpiresAtUnixMs:         grantExpiresAt.UnixMilli(),
			NodePeerId:              nodePeerID.String(),
			NodeAuthorizationDigest: verifiedAuthorization.Digest[:],
		},
		now,
	)
	if err != nil {
		t.Fatalf("sign connection grant: %v", err)
	}
	grantBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	if err != nil {
		t.Fatalf("marshal connection grant: %v", err)
	}
	grantDigestBytes := sha256.Sum256(grantBytes)
	grantDigest := hex.EncodeToString(grantDigestBytes[:])
	repository := &discoveryTestRepository{
		enrollment: domain.Enrollment{
			StationPeerID:          stationPeerID.String(),
			NodePeerID:             nodePeerID.String(),
			NodeAuthorizationUntil: now.Add(time.Hour),
			Status:                 domain.EnrollmentStatusOnline,
			Generation:             9,
		},
	}
	admission := nativeRelay.NewAdmission()
	if err := admission.AdmitNode(nativeRelay.NodeAdmission{
		StationPeerID: stationPeerID.String(),
		NodePeerID:    nodePeerID,
		Generation:    9,
		ExpiresAt:     now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("admit destination: %v", err)
	}
	if err := admission.PublishRoute(nativeRelay.RouteAdmission{
		NodePeerID: nodePeerID,
		Generation: 9,
		Public:     false,
		ExpiresAt:  routeExpiresAt,
	}); err != nil {
		t.Fatalf("publish destination route: %v", err)
	}
	service := NewService(repository, authority, admission)
	service.now = func() time.Time { return now }
	service.routes[routeStatement.GetRouteId()] = domain.RouteRecord{
		RouteID:          routeStatement.GetRouteId(),
		StationPeerID:    stationPeerID.String(),
		NodePeerID:       nodePeerID.String(),
		RelayPeerID:      authority.RelayPeerID(),
		RouteGeneration:  9,
		Visibility:       routeStatement.GetVisibility(),
		ExpiresAt:        routeExpiresAt,
		AttestationBytes: routeBytes,
	}
	service.grants[grantDigest] = domain.GrantRecord{
		GrantID:         "grant-a",
		GrantDigest:     grantDigest,
		StationPeerID:   stationPeerID.String(),
		RelayPeerID:     authority.RelayPeerID(),
		RouteID:         routeStatement.GetRouteId(),
		RouteGeneration: 9,
		MaxUses:         1,
		RemainingUses:   1,
		ExpiresAt:       grantExpiresAt,
	}
	return privateDiscoveryFixture{
		service:       service,
		admission:     admission,
		grantBytes:    grantBytes,
		grantDigest:   grantDigest,
		destinationID: nodePeerID,
		now:           now,
	}
}

func sourcePrivateKey(t *testing.T) libp2pcrypto.PrivKey {
	t.Helper()
	privateKey, _, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate source key: %v", err)
	}
	return privateKey
}

func sourceProof(
	t *testing.T,
	sourcePrivateKey libp2pcrypto.PrivKey,
	challenge []byte,
	grantBytes []byte,
	relayPeerID string,
) *peerpb.AccessEndpointSourceProof {
	t.Helper()
	grantDigest := sha256.Sum256(grantBytes)
	proof, err := peerpb.SignAccessEndpointSourceProof(
		sourcePrivateKey,
		&peerpb.AccessEndpointSourceProofStatement{
			Challenge:             challenge,
			ConnectionGrantDigest: grantDigest[:],
			RelayPeerId:           relayPeerID,
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
	)
	if err != nil {
		t.Fatalf("sign source proof: %v", err)
	}
	return proof
}

func discoverPrivate(
	t *testing.T,
	fixture privateDiscoveryFixture,
	challenge []byte,
	proof *peerpb.AccessEndpointSourceProof,
) *peerpb.AccessEndpointResponse {
	t.Helper()
	response, err := fixture.service.DiscoverEndpoint(
		context.Background(),
		&peerpb.AccessEndpointRequest{
			Challenge:             challenge,
			ConnectionGrant:       fixture.grantBytes,
			ClientProtocolVersion: domain.AccessProtocolVersion,
			SourceProof:           proof,
		},
		"https://relay.example",
	)
	if err != nil {
		t.Fatalf("discover private endpoint: %v", err)
	}
	return response
}
