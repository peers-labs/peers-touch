package peer

import (
	"bytes"
	"crypto/sha256"
	"sort"
	"strings"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"google.golang.org/protobuf/proto"
)

type VerifiedStationRouteAttestation struct {
	Statement     *StationRouteStatement
	Authorization *VerifiedStationNodeAuthorization
}

type VerifiedStationConnectionGrant struct {
	Statement     *StationConnectionGrantStatement
	Authorization *VerifiedStationNodeAuthorization
}

func SignStationRouteAttestation(
	nodePrivateKey libp2pcrypto.PrivKey,
	authorization *StationNodeAuthorization,
	statement *StationRouteStatement,
	now time.Time,
) (*StationRouteAttestation, error) {
	if statement == nil {
		return nil, ErrStationRouteAttestationInvalid
	}
	verified, err := VerifyStationNodeAuthorization(authorization, now)
	if err != nil ||
		!nodePrivateKeyMatches(nodePrivateKey, verified) ||
		!validStationRouteStatement(
			statement,
			verified,
			statement.GetRelayPeerId(),
			now,
		) {
		return nil, ErrStationRouteAttestationInvalid
	}
	statementBytes, err := marshalDeterministicBounded(statement)
	if err != nil {
		return nil, ErrStationRouteAttestationInvalid
	}
	signature, err := nodePrivateKey.Sign(
		domainMessage(StationRouteDomain, statementBytes),
	)
	if err != nil {
		return nil, ErrStationRouteAttestationInvalid
	}
	return &StationRouteAttestation{
		StatementBytes:    statementBytes,
		NodeSignature:     signature,
		NodeAuthorization: proto.Clone(authorization).(*StationNodeAuthorization),
	}, nil
}

func VerifyStationRouteAttestation(
	attestation *StationRouteAttestation,
	expectedRelayPeerID string,
	now time.Time,
) (*VerifiedStationRouteAttestation, error) {
	if attestation == nil {
		return nil, ErrStationRouteAttestationInvalid
	}
	if raw, err := marshalDeterministicBounded(attestation); err != nil ||
		len(raw) > MaxSignedControlBytes {
		return nil, ErrStationRouteAttestationInvalid
	}
	authorization, err := VerifyStationNodeAuthorization(
		attestation.GetNodeAuthorization(),
		now,
	)
	if err != nil {
		return nil, ErrStationRouteAttestationInvalid
	}
	statement := &StationRouteStatement{}
	if err := unmarshalCanonicalBounded(
		attestation.GetStatementBytes(),
		statement,
	); err != nil ||
		!validStationRouteStatement(
			statement,
			authorization,
			expectedRelayPeerID,
			now,
		) {
		return nil, ErrStationRouteAttestationInvalid
	}
	valid, err := authorization.NodePublicKey.Verify(
		domainMessage(
			StationRouteDomain,
			attestation.GetStatementBytes(),
		),
		attestation.GetNodeSignature(),
	)
	if err != nil || !valid {
		return nil, ErrStationRouteAttestationInvalid
	}
	return &VerifiedStationRouteAttestation{
		Statement:     statement,
		Authorization: authorization,
	}, nil
}

func SignStationConnectionGrant(
	nodePrivateKey libp2pcrypto.PrivKey,
	authorization *StationNodeAuthorization,
	statement *StationConnectionGrantStatement,
	now time.Time,
) (*StationConnectionGrant, error) {
	verified, err := VerifyStationNodeAuthorization(authorization, now)
	if err != nil ||
		!nodePrivateKeyMatches(nodePrivateKey, verified) ||
		!validStationConnectionGrantStatement(statement, verified, now) {
		return nil, ErrStationConnectionGrantInvalid
	}
	statementBytes, err := marshalDeterministicBounded(statement)
	if err != nil {
		return nil, ErrStationConnectionGrantInvalid
	}
	signature, err := nodePrivateKey.Sign(
		domainMessage(ConnectionGrantDomain, statementBytes),
	)
	if err != nil {
		return nil, ErrStationConnectionGrantInvalid
	}
	return &StationConnectionGrant{
		StatementBytes:    statementBytes,
		NodeSignature:     signature,
		NodeAuthorization: proto.Clone(authorization).(*StationNodeAuthorization),
	}, nil
}

func VerifyStationConnectionGrant(
	grant *StationConnectionGrant,
	now time.Time,
) (*VerifiedStationConnectionGrant, error) {
	if grant == nil {
		return nil, ErrStationConnectionGrantInvalid
	}
	if raw, err := marshalDeterministicBounded(grant); err != nil ||
		len(raw) > MaxSignedControlBytes {
		return nil, ErrStationConnectionGrantInvalid
	}
	authorization, err := VerifyStationNodeAuthorization(
		grant.GetNodeAuthorization(),
		now,
	)
	if err != nil {
		return nil, ErrStationConnectionGrantInvalid
	}
	statement := &StationConnectionGrantStatement{}
	if err := unmarshalCanonicalBounded(
		grant.GetStatementBytes(),
		statement,
	); err != nil ||
		!validStationConnectionGrantStatement(
			statement,
			authorization,
			now,
		) {
		return nil, ErrStationConnectionGrantInvalid
	}
	valid, err := authorization.NodePublicKey.Verify(
		domainMessage(
			ConnectionGrantDomain,
			grant.GetStatementBytes(),
		),
		grant.GetNodeSignature(),
	)
	if err != nil || !valid {
		return nil, ErrStationConnectionGrantInvalid
	}
	return &VerifiedStationConnectionGrant{
		Statement:     statement,
		Authorization: authorization,
	}, nil
}

func validStationRouteStatement(
	statement *StationRouteStatement,
	authorization *VerifiedStationNodeAuthorization,
	expectedRelayPeerID string,
	now time.Time,
) bool {
	if statement == nil ||
		authorization == nil ||
		statement.GetStationPeerId() !=
			authorization.Statement.GetStationPeerId() ||
		statement.GetNodePeerId() !=
			authorization.Statement.GetNodePeerId() ||
		statement.GetRouteId() == "" ||
		statement.GetRouteId() != strings.TrimSpace(statement.GetRouteId()) ||
		statement.GetRouteGeneration() == 0 ||
		len(statement.GetInnerTlsSpkiSha256()) != sha256.Size ||
		!bytes.Equal(
			statement.GetCapabilitiesDigest(),
			authorization.Statement.GetCapabilitiesDigest(),
		) ||
		!bytes.Equal(
			statement.GetNodeAuthorizationDigest(),
			authorization.Digest[:],
		) ||
		(statement.GetVisibility() !=
			StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC &&
			statement.GetVisibility() !=
				StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY) ||
		!canonicalRouteAddresses(statement.GetAddresses()) {
		return false
	}
	switch statement.GetKind() {
	case StationRouteKind_STATION_ROUTE_KIND_DIRECT:
		if statement.GetRelayPeerId() != "" || expectedRelayPeerID != "" {
			return false
		}
	case StationRouteKind_STATION_ROUTE_KIND_CIRCUIT:
		if statement.GetRelayPeerId() == "" ||
			statement.GetRelayPeerId() != expectedRelayPeerID {
			return false
		}
	default:
		return false
	}
	if !routeAddressesMatchKind(statement) {
		return false
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	authorizationExpiresAt := time.UnixMilli(
		authorization.Statement.GetExpiresAtUnixMs(),
	).UTC()
	return !issuedAt.After(now.UTC().Add(stationTrustClockSkew)) &&
		expiresAt.After(now.UTC()) &&
		expiresAt.Sub(issuedAt) > 0 &&
		expiresAt.Sub(issuedAt) <= MaxRouteAttestationLifetime &&
		!expiresAt.After(authorizationExpiresAt)
}

func validStationConnectionGrantStatement(
	statement *StationConnectionGrantStatement,
	authorization *VerifiedStationNodeAuthorization,
	now time.Time,
) bool {
	if statement == nil ||
		authorization == nil ||
		statement.GetGrantId() == "" ||
		statement.GetGrantId() != strings.TrimSpace(statement.GetGrantId()) ||
		statement.GetStationPeerId() !=
			authorization.Statement.GetStationPeerId() ||
		statement.GetNodePeerId() !=
			authorization.Statement.GetNodePeerId() ||
		statement.GetRelayPeerId() == "" ||
		statement.GetRouteId() == "" ||
		statement.GetRouteGeneration() == 0 ||
		statement.GetMaxUses() == 0 ||
		statement.GetMaxUses() > MaxConnectionGrantUses ||
		!bytes.Equal(
			statement.GetNodeAuthorizationDigest(),
			authorization.Digest[:],
		) {
		return false
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	authorizationExpiresAt := time.UnixMilli(
		authorization.Statement.GetExpiresAtUnixMs(),
	).UTC()
	return !issuedAt.After(now.UTC().Add(stationTrustClockSkew)) &&
		expiresAt.After(now.UTC()) &&
		expiresAt.Sub(issuedAt) > 0 &&
		expiresAt.Sub(issuedAt) <= MaxConnectionGrantLifetime &&
		!expiresAt.After(authorizationExpiresAt)
}

func nodePrivateKeyMatches(
	nodePrivateKey libp2pcrypto.PrivKey,
	authorization *VerifiedStationNodeAuthorization,
) bool {
	if nodePrivateKey == nil ||
		nodePrivateKey.Type() != libp2pcrypto.Ed25519 ||
		authorization == nil {
		return false
	}
	nodePeerID, err := libp2ppeer.IDFromPrivateKey(nodePrivateKey)
	return err == nil &&
		nodePeerID.String() == authorization.Statement.GetNodePeerId()
}

func canonicalRouteAddresses(addresses []string) bool {
	if len(addresses) == 0 || len(addresses) > 16 {
		return false
	}
	if !sort.StringsAreSorted(addresses) {
		return false
	}
	for index, address := range addresses {
		if address == "" ||
			address != strings.TrimSpace(address) ||
			len(address) > 2048 ||
			(index > 0 && addresses[index-1] == address) {
			return false
		}
	}
	return true
}

func routeAddressesMatchKind(statement *StationRouteStatement) bool {
	var suffix string
	switch statement.GetKind() {
	case StationRouteKind_STATION_ROUTE_KIND_DIRECT:
		suffix = "/p2p/" + statement.GetNodePeerId()
	case StationRouteKind_STATION_ROUTE_KIND_CIRCUIT:
		suffix = "/p2p/" + statement.GetRelayPeerId() +
			"/p2p-circuit/p2p/" + statement.GetNodePeerId()
	default:
		return false
	}
	for _, raw := range statement.GetAddresses() {
		address, err := multiaddr.NewMultiaddr(raw)
		if err != nil || address.String() != raw || !strings.HasSuffix(raw, suffix) {
			return false
		}
		prefix := strings.TrimSuffix(raw, suffix)
		if prefix == "" ||
			strings.Contains(prefix, "/p2p/") ||
			strings.Contains(prefix, "/p2p-circuit") {
			return false
		}
		if _, err := multiaddr.NewMultiaddr(prefix); err != nil {
			return false
		}
	}
	return true
}
