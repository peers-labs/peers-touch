package relay_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

func TestRelayDiscoveryFiltersRoutesAndConsumesPrivateGrant(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()
	ctx := context.Background()
	station := newTestStation(t)
	_, secret, err := env.svc.CreateInvite(
		ctx,
		station.peerID,
		"discovery",
		2,
		0,
		time.Hour,
	)
	require.NoError(t, err)
	enrolled := enrollStation(t, env, secret, "discovery", station, 10)
	identity, err := env.svc.AuthenticateMountCredential(
		ctx,
		enrolled.Credential.Token,
		domain.ScopeRoutePublish,
	)
	require.NoError(t, err)
	require.NoError(t, env.svc.ActivateMount(ctx, identity))

	publicRoute := signRouteAttestation(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"public-route",
		enrolled.Credential.Generation,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
	)
	_, err = env.svc.PublishStationRoute(ctx, identity, publicRoute)
	require.NoError(t, err)
	privateRoute := signRouteAttestation(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"private-route",
		enrolled.Credential.Generation,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
	)
	_, err = env.svc.PublishStationRoute(ctx, identity, privateRoute)
	require.NoError(t, err)

	publicDiscovery, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x31}, 32),
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY,
		publicDiscovery.GetOutcome(),
	)
	require.Len(t, publicDiscovery.GetStationRoutes(), 1)
	endpointStatement := &peerpb.AccessEndpointStatement{}
	require.NoError(
		t,
		proto.Unmarshal(
			publicDiscovery.GetEndpointStatementBytes(),
			endpointStatement,
		),
	)
	require.Equal(
		t,
		peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		endpointStatement.GetEndpointRole(),
	)
	require.Equal(
		t,
		enrolled.Credential.RelayPeerID,
		endpointStatement.GetEndpointPeerId(),
	)
	relayPublicKey, err := libp2pcrypto.UnmarshalPublicKey(
		publicDiscovery.GetEndpointPublicKey(),
	)
	require.NoError(t, err)
	verified, err := relayPublicKey.Verify(
		append(
			[]byte(domain.AccessEndpointDomain),
			publicDiscovery.GetEndpointStatementBytes()...,
		),
		publicDiscovery.GetEndpointSignature(),
	)
	require.NoError(t, err)
	require.True(t, verified)
	publicStatement := &peerpb.StationRouteStatement{}
	require.NoError(
		t,
		proto.Unmarshal(
			publicDiscovery.GetStationRoutes()[0].GetStatementBytes(),
			publicStatement,
		),
	)
	require.Equal(t, "public-route", publicStatement.GetRouteId())

	grant := signConnectionGrant(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"grant-1",
		"private-route",
		enrolled.Credential.Generation,
		time.Now().UTC(),
	)
	grantBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	require.NoError(t, err)
	grantDigest := sha256.Sum256(grantBytes)
	grantStatement := &peerpb.StationConnectionGrantStatement{}
	require.NoError(t, proto.Unmarshal(grant.GetStatementBytes(), grantStatement))
	_, err = env.svc.RegisterConnectionGrant(
		ctx,
		identity,
		&peerpb.RegisterStationConnectionGrantRequest{
			GrantDigest:     grantDigest[:],
			GrantId:         grantStatement.GetGrantId(),
			RouteId:         grantStatement.GetRouteId(),
			RouteGeneration: grantStatement.GetRouteGeneration(),
			MaxUses:         grantStatement.GetMaxUses(),
			ExpiresAtUnixMs: grantStatement.GetExpiresAtUnixMs(),
		},
	)
	require.NoError(t, err)

	privateDiscovery, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x32}, 32),
			ConnectionGrant:       grantBytes,
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY,
		privateDiscovery.GetOutcome(),
	)
	require.Len(t, privateDiscovery.GetStationRoutes(), 1)
	authorizedRoute, err := env.svc.AuthorizeClientTunnel(
		ctx,
		grantBytes,
		"private-route",
		enrolled.Credential.Generation,
	)
	require.NoError(t, err)
	require.Equal(t, station.peerID, authorizedRoute.StationPeerID)
	_, err = env.svc.AuthorizeClientTunnel(
		ctx,
		grantBytes,
		"private-route",
		enrolled.Credential.Generation,
	)
	require.ErrorIs(t, err, application.ErrTunnelUnauthorized)

	replayed, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x33}, 32),
			ConnectionGrant:       grantBytes,
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_REPLAYED,
		replayed.GetOutcome(),
	)
	require.Empty(t, replayed.GetStationRoutes())
}

func TestRelayDiscoveryReturnsTypedCandidateAndGrantFailures(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()
	ctx := context.Background()
	station := newTestStation(t)
	_, secret, err := env.svc.CreateInvite(
		ctx,
		station.peerID,
		"discovery-failures",
		2,
		0,
		time.Hour,
	)
	require.NoError(t, err)
	enrolled := enrollStation(
		t,
		env,
		secret,
		"discovery-failures",
		station,
		10,
	)
	identity, err := env.svc.AuthenticateMountCredential(
		ctx,
		enrolled.Credential.Token,
		domain.ScopeRoutePublish,
	)
	require.NoError(t, err)
	require.NoError(t, env.svc.ActivateMount(ctx, identity))

	empty, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x51}, 32),
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_NO_CANDIDATES,
		empty.GetOutcome(),
	)

	for _, routeID := range []string{"public-a", "public-b"} {
		_, err = env.svc.PublishStationRoute(
			ctx,
			identity,
			signRouteAttestation(
				t,
				station,
				enrolled.Credential.RelayPeerID,
				routeID,
				enrolled.Credential.Generation,
				peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
			),
		)
		require.NoError(t, err)
	}
	multiple, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x52}, 32),
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_MULTIPLE_CANDIDATES,
		multiple.GetOutcome(),
	)
	require.Len(t, multiple.GetStationRoutes(), 2)

	forged := signRouteAttestation(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"forged",
		enrolled.Credential.Generation,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
	)
	forged.Signature[0] ^= 0xff
	_, err = env.svc.PublishStationRoute(ctx, identity, forged)
	require.ErrorIs(t, err, application.ErrRouteAttestationInvalid)

	wrongRelayGrant := signConnectionGrant(
		t,
		station,
		"wrong-relay",
		"wrong-relay-grant",
		"public-a",
		enrolled.Credential.Generation,
		time.Now().UTC(),
	)
	wrongRelayBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(wrongRelayGrant)
	require.NoError(t, err)
	wrongRelay, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x53}, 32),
			ConnectionGrant:       wrongRelayBytes,
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_WRONG_RELAY,
		wrongRelay.GetOutcome(),
	)

	expiredGrant := signConnectionGrant(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"expired-grant",
		"public-a",
		enrolled.Credential.Generation,
		time.Now().Add(-2*time.Minute).UTC(),
	)
	expiredBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(expiredGrant)
	require.NoError(t, err)
	expired, err := env.svc.DiscoverEndpoint(
		ctx,
		&peerpb.AccessEndpointRequest{
			Challenge:             bytes.Repeat([]byte{0x54}, 32),
			ConnectionGrant:       expiredBytes,
			ClientProtocolVersion: domain.AccessProtocolVersion,
		},
		"https://relay.example:443",
	)
	require.NoError(t, err)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_EXPIRED,
		expired.GetOutcome(),
	)
}

func TestRegisterConnectionGrantRetryPreservesRemainingUses(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()
	ctx := context.Background()
	station := newTestStation(t)
	_, secret, err := env.svc.CreateInvite(
		ctx,
		station.peerID,
		"grant-retry",
		2,
		0,
		time.Hour,
	)
	require.NoError(t, err)
	enrolled := enrollStation(t, env, secret, "grant-retry", station, 10)
	identity, err := env.svc.AuthenticateMountCredential(
		ctx,
		enrolled.Credential.Token,
		domain.ScopeRoutePublish,
	)
	require.NoError(t, err)
	require.NoError(t, env.svc.ActivateMount(ctx, identity))

	route := signRouteAttestation(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"retry-route",
		enrolled.Credential.Generation,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
	)
	_, err = env.svc.PublishStationRoute(ctx, identity, route)
	require.NoError(t, err)

	grant := signConnectionGrantWithMaxUses(
		t,
		station,
		enrolled.Credential.RelayPeerID,
		"retry-grant",
		"retry-route",
		enrolled.Credential.Generation,
		2,
		time.Now().UTC(),
	)
	grantBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	require.NoError(t, err)
	grantDigest := sha256.Sum256(grantBytes)
	statement := &peerpb.StationConnectionGrantStatement{}
	require.NoError(t, proto.Unmarshal(grant.GetStatementBytes(), statement))
	register := &peerpb.RegisterStationConnectionGrantRequest{
		GrantDigest:     grantDigest[:],
		GrantId:         statement.GetGrantId(),
		RouteId:         statement.GetRouteId(),
		RouteGeneration: statement.GetRouteGeneration(),
		MaxUses:         statement.GetMaxUses(),
		ExpiresAtUnixMs: statement.GetExpiresAtUnixMs(),
	}
	first, err := env.svc.RegisterConnectionGrant(ctx, identity, register)
	require.NoError(t, err)
	require.Equal(t, uint32(2), first.RemainingUses)

	discover := func(challenge byte) peerpb.AccessEndpointOutcome {
		response, discoverErr := env.svc.DiscoverEndpoint(
			ctx,
			&peerpb.AccessEndpointRequest{
				Challenge:             bytes.Repeat([]byte{challenge}, 32),
				ConnectionGrant:       grantBytes,
				ClientProtocolVersion: domain.AccessProtocolVersion,
			},
			"https://relay.example:443",
		)
		require.NoError(t, discoverErr)
		return response.GetOutcome()
	}
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY,
		discover(0x61),
	)

	retried, err := env.svc.RegisterConnectionGrant(ctx, identity, register)
	require.NoError(t, err)
	require.Equal(t, uint32(1), retried.RemainingUses)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY,
		discover(0x62),
	)
	require.Equal(
		t,
		peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_GRANT_REPLAYED,
		discover(0x63),
	)
}

func signRouteAttestation(
	t *testing.T,
	station testStation,
	relayPeerID string,
	routeID string,
	generation uint64,
	visibility peerpb.StationRouteVisibility,
) *peerpb.StationRouteAttestation {
	t.Helper()
	now := time.Now().UTC()
	statement := &peerpb.StationRouteStatement{
		StationPeerId:      station.peerID,
		RelayPeerId:        relayPeerID,
		RouteId:            routeID,
		RouteGeneration:    generation,
		InnerTlsSpkiSha256: bytes.Repeat([]byte{0x41}, sha256.Size),
		CapabilitiesDigest: bytes.Repeat([]byte{0x42}, sha256.Size),
		Visibility:         visibility,
		IssuedAtUnixMs:     now.Add(-time.Second).UnixMilli(),
		ExpiresAtUnixMs:    now.Add(time.Hour).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	require.NoError(t, err)
	signature, err := station.privateKey.Sign(
		append([]byte(domain.StationRouteDomain), statementBytes...),
	)
	require.NoError(t, err)
	publicKey, err := libp2pcrypto.MarshalPublicKey(
		station.privateKey.GetPublic(),
	)
	require.NoError(t, err)
	return &peerpb.StationRouteAttestation{
		StatementBytes: statementBytes,
		HostPublicKey:  publicKey,
		Signature:      signature,
	}
}

func signConnectionGrant(
	t *testing.T,
	station testStation,
	relayPeerID string,
	grantID string,
	routeID string,
	generation uint64,
	now time.Time,
) *peerpb.StationConnectionGrant {
	return signConnectionGrantWithMaxUses(
		t,
		station,
		relayPeerID,
		grantID,
		routeID,
		generation,
		1,
		now,
	)
}

func signConnectionGrantWithMaxUses(
	t *testing.T,
	station testStation,
	relayPeerID string,
	grantID string,
	routeID string,
	generation uint64,
	maxUses uint32,
	now time.Time,
) *peerpb.StationConnectionGrant {
	t.Helper()
	statement := &peerpb.StationConnectionGrantStatement{
		GrantId:         grantID,
		StationPeerId:   station.peerID,
		RelayPeerId:     relayPeerID,
		RouteId:         routeID,
		RouteGeneration: generation,
		MaxUses:         maxUses,
		IssuedAtUnixMs:  now.UnixMilli(),
		ExpiresAtUnixMs: now.Add(time.Minute).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	require.NoError(t, err)
	signature, err := station.privateKey.Sign(
		append([]byte(domain.ConnectionGrantDomain), statementBytes...),
	)
	require.NoError(t, err)
	publicKey, err := libp2pcrypto.MarshalPublicKey(
		station.privateKey.GetPublic(),
	)
	require.NoError(t, err)
	return &peerpb.StationConnectionGrant{
		StatementBytes: statementBytes,
		HostPublicKey:  publicKey,
		Signature:      signature,
	}
}
