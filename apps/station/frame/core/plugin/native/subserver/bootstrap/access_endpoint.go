package bootstrap

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	accessEndpointDomain   = "peers-touch/access-endpoint/v1\x00"
	accessEndpointLifetime = time.Minute
	accessProtocolVersion  = uint32(1)
)

var directEndpointCapabilities = []string{
	"access-gate",
	"endpoint-discovery",
	"station-identity",
}

func (s *SubServer) AccessEndpoint(
	_ context.Context,
	req *peerpb.AccessEndpointRequest,
) (*peerpb.AccessEndpointResponse, error) {
	if s.host == nil {
		return nil, fmt.Errorf("Station endpoint node is not ready")
	}
	privateKey := s.host.Peerstore().PrivKey(s.host.ID())
	if privateKey == nil {
		return nil, fmt.Errorf("Station endpoint node key is unavailable")
	}
	now := time.Now().UTC()
	authorization, err := s.currentNodeAuthorization(now)
	if err != nil {
		return nil, err
	}
	response, err := signAccessEndpoint(
		privateKey,
		s.host.ID(),
		authorization,
		canonicalStationOrigin(),
		req,
		now,
	)
	if err != nil {
		return nil, err
	}
	if s.opts.CircuitRoutes == nil {
		return response, nil
	}
	for _, route := range s.opts.CircuitRoutes(now) {
		addresses := make([]string, 0, len(route.DialMultiaddrs))
		for _, address := range route.DialMultiaddrs {
			addresses = append(addresses, address.String())
		}
		sort.Strings(addresses)
		expiresAt := route.ExpiresAt
		maxExpiry := now.Add(peerpb.MaxRouteAttestationLifetime)
		if expiresAt.After(maxExpiry) {
			expiresAt = maxExpiry
		}
		attestation, signErr := s.SignStationRouteAttestation(
			&peerpb.StationRouteStatement{
				RelayPeerId: route.RelayPeerID.String(),
				RouteId: "circuit-" + route.RelayPeerID.String() +
					"-" + s.host.ID().String(),
				RouteGeneration:    route.RouteGeneration,
				InnerTlsSpkiSha256: s.opts.InnerTLSSPKISHA256[:],
				Visibility: peerpb.
					StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
				IssuedAtUnixMs:  now.UnixMilli(),
				ExpiresAtUnixMs: expiresAt.UnixMilli(),
				Addresses:       addresses,
			},
		)
		if signErr != nil {
			return nil, fmt.Errorf("sign standard Circuit route: %w", signErr)
		}
		response.StationRoutes = append(response.StationRoutes, attestation)
	}
	return response, nil
}

func signAccessEndpoint(
	privateKey crypto.PrivKey,
	endpointPeerID peer.ID,
	authorization *peerpb.StationNodeAuthorization,
	canonicalOrigin string,
	req *peerpb.AccessEndpointRequest,
	now time.Time,
) (*peerpb.AccessEndpointResponse, error) {
	if req == nil ||
		len(req.GetChallenge()) != peerpb.StationIdentityChallengeSize {
		return nil, fmt.Errorf(
			"access endpoint challenge must contain exactly %d bytes",
			peerpb.StationIdentityChallengeSize,
		)
	}
	if req.GetClientProtocolVersion() != accessProtocolVersion {
		return nil, fmt.Errorf(
			"unsupported access endpoint protocol version: %d",
			req.GetClientProtocolVersion(),
		)
	}
	if len(req.GetConnectionGrant()) != 0 {
		return nil, fmt.Errorf("direct Station does not accept a connection grant")
	}
	if privateKey.Type() != crypto.Ed25519 {
		return nil, fmt.Errorf("Station endpoint identity key must be Ed25519")
	}
	if endpointPeerID == "" || canonicalOrigin == "" {
		return nil, fmt.Errorf("Station endpoint identity is incomplete")
	}
	derivedPeerID, err := peer.IDFromPrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("derive Station endpoint peer ID: %w", err)
	}
	if derivedPeerID != endpointPeerID {
		return nil, fmt.Errorf("Station endpoint key does not match peer ID")
	}
	verifiedAuthorization, err := peerpb.VerifyStationNodeAuthorization(
		authorization,
		now,
	)
	if err != nil ||
		verifiedAuthorization.Statement.GetNodePeerId() !=
			endpointPeerID.String() {
		return nil, fmt.Errorf("Station endpoint node authorization is invalid")
	}

	capabilities := append([]string(nil), directEndpointCapabilities...)
	sort.Strings(capabilities)
	statement := &peerpb.AccessEndpointStatement{
		Challenge:               append([]byte(nil), req.GetChallenge()...),
		EndpointRole:            peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
		EndpointPeerId:          endpointPeerID.String(),
		CanonicalOrigin:         canonicalOrigin,
		ProtocolVersions:        []uint32{accessProtocolVersion},
		Capabilities:            capabilities,
		IssuedAtUnixMs:          now.UnixMilli(),
		ExpiresAtUnixMs:         now.Add(accessEndpointLifetime).UnixMilli(),
		NodeAuthorizationDigest: verifiedAuthorization.Digest[:],
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		return nil, fmt.Errorf("marshal Station endpoint statement: %w", err)
	}
	signature, err := privateKey.Sign(
		append([]byte(accessEndpointDomain), statementBytes...),
	)
	if err != nil {
		return nil, fmt.Errorf("sign Station endpoint statement: %w", err)
	}
	publicKey, err := crypto.MarshalPublicKey(privateKey.GetPublic())
	if err != nil {
		return nil, fmt.Errorf("marshal Station endpoint public key: %w", err)
	}
	return &peerpb.AccessEndpointResponse{
		Outcome:                peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_READY,
		EndpointStatementBytes: statementBytes,
		EndpointPublicKey:      publicKey,
		EndpointSignature:      signature,
		NodeAuthorization:      authorization,
	}, nil
}
